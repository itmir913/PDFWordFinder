import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { findKeywordRectsAndKeywords, addOutlines, addHighlightAnnotation } from './lib/pdf-highlight.js';
import { buildPattern, buildCompactPattern } from './lib/keywords.js';
import { buildSheetResult, dateFormatFor, SHEET_READ_OPTIONS } from './lib/excel.js';
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

// 한 건을 끝낼 때마다 'ready'를 보내고, 스토어가 그때 다음 파일을 읽어 보낸다.
//
// 예전에는 스토어가 모든 파일 바이트를 한꺼번에 큐에 밀어 넣었다. 학년 전체
// 생기부처럼 파일이 많으면 전부가 동시에 메모리에 올라갔고, 큐에 들어간
// 뒤에는 중지를 눌러도 끝까지 처리됐다.
let chain = Promise.resolve();

self.onmessage = (e) => {
  const msg = e.data;
  chain = chain
    .then(async () => {
      if (msg.type === 'process') {
        await processTask(msg);
        self.postMessage({ type: 'ready' });
      } else if (msg.type === 'end') {
        self.postMessage({ type: 'done' });
      }
    })
    .catch((err) => {
      // processTask가 스스로 잡지 못한 예외까지 여기서 알린다 —
      // 조용히 멈추면 스토어가 다음 파일을 영영 보내지 않는다.
      self.postMessage({ type: 'error', id: msg.id, name: msg.name, message: String(err) });
      self.postMessage({ type: 'ready' });
    });
};

async function processTask(task) {
  try {
    if (task.ext === 'pdf') await processPdf(task);
    else if (task.ext === 'xlsx') await processExcel(task);
    else self.postMessage({ type: 'error', id: task.id, name: task.name, message: `지원하지 않는 형식: .${task.ext}` });
  } catch (e) {
    self.postMessage({ type: 'error', id: task.id, name: task.name, message: String(e) });
  }
}

// ── PDF 처리 ──────────────────────────────────────────────────────

async function processPdf({ id, name, outputPath, data, keywords, detectConsecutiveSpaces }) {
  if (!keywords || keywords.length === 0) {
    self.postMessage({ type: 'error', id, name, message: '검색 단어 목록이 비어 있습니다.' });
    return;
  }

  self.postMessage({ type: 'progress', id, status: '처리중' });
  self.postMessage({ type: 'log', message: `▶ PDF 처리 시작: ${name}` });

  // PDF는 공백을 지운 형태로 맞춘다 — pdfjs가 자간·커닝 경계에서 공백을
  // 끼워 넣거나 한 단어를 여러 아이템으로 쪼개기 때문이다.
  const { pattern, kwMap } = buildCompactPattern(keywords);

  // Step 1: pdfjs-dist로 텍스트 위치 추출
  //
  // pdfjs는 getDocument 호출마다 워커 스레드를 새로 만들고, 그 스레드는
  // loadingTask.destroy()로만 끝난다. 정리하지 않으면 처리한 파일 수만큼
  // 스레드와 파싱된 문서가 그대로 살아 있는다.
  // isEvalSupported: false — 텍스트 추출만 하므로 pdfjs의 eval 경로가
  // 필요 없다. CSP에서 'unsafe-eval'을 뺄 수 있는 전제다.
  const loadingTask = pdfjsLib.getDocument({ data: data.slice(), isEvalSupported: false });
  const pageHighlights = [];
  let totalFound = 0;

  try {
    const pdf = await loadingTask.promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      try {
        const content = await page.getTextContent();
        const { rects, matchedKeywords } = findKeywordRectsAndKeywords(content.items, pattern, kwMap);
        if (rects.length > 0) {
          pageHighlights.push({ pageIndex: p - 1, rects, keywords: matchedKeywords });
          totalFound += rects.length;
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  // Step 2: pdf-lib으로 하이라이트 + 북마크 추가
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(data);
  } catch (e) {
    // 메시지 문구가 아니라 예외 종류로 판정한다. pdf-lib이 문구를 바꾸면
    // 조용히 rethrow되어 사용자는 원인 불명 실패만 보게 된다.
    if (e?.name === 'EncryptedPDFError' || String(e).includes('encrypted')) {
      self.postMessage({
        type: 'error', id, name,
        message: '암호화(보안 설정)된 PDF는 하이라이트를 추가할 수 없습니다. 보안 해제 후 다시 시도하세요.',
      });
      return;
    }
    throw e;
  }

  for (const { pageIndex, rects } of pageHighlights) {
    const page = pdfDoc.getPage(pageIndex);
    for (const quad of rects) {
      addHighlightAnnotation(pdfDoc, page, quad);
    }
  }

  // 북마크: 페이지별·키워드별 1개 (중복 제거)
  const outlineItems = pageHighlights.flatMap(({ pageIndex, keywords }) =>
    [...keywords].map(kw => ({ title: `P${pageIndex + 1}: ${kw}`, pageIndex }))
  );
  let preservedOutlines = 0;
  if (outlineItems.length > 0) {
    ({ preserved: preservedOutlines } = addOutlines(pdfDoc, outlineItems));
  }

  const outBytes = await pdfDoc.save();
  const resultData = new Uint8Array(outBytes);

  self.postMessage(
    { type: 'result', id, name, outputPath, data: resultData },
    [resultData.buffer]
  );
  const kept = preservedOutlines > 0 ? `, 기존 북마크 ${preservedOutlines}개 유지` : '';
  self.postMessage({
    type: 'log',
    message: `✅ PDF 변환 완료 | 탐지 ${totalFound}건, 북마크 ${outlineItems.length}개 추가${kept}`,
  });
}

// ── Excel 처리 ────────────────────────────────────────────────────
async function processExcel({ id, name, outputPath, data, keywords, detectConsecutiveSpaces }) {
  if (!keywords || keywords.length === 0) {
    self.postMessage({ type: 'error', id, name, message: '검색 단어 목록이 비어 있습니다.' });
    return;
  }

  self.postMessage({ type: 'progress', id, status: '처리중' });
  self.postMessage({ type: 'log', message: `▶ Excel 처리 시작: ${name}` });

  const { pattern, kwMap } = buildPattern(keywords);

  const wb = XLSX.read(data, SHEET_READ_OPTIONS);

  const excelWb = new ExcelJS.Workbook();
  let totalDetectedCount = 0;
  let totalRowCount = 0;

  for (const wsName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { header: 1, defval: '' });
    const { resultRows, detectedCount, rowCount, detectedColIndex } =
      buildSheetResult(rows, pattern, kwMap, detectConsecutiveSpaces);

    const excelWs = excelWb.addWorksheet(wsName);
    const colCount = resultRows[0].length;

    for (let r = 0; r < resultRows.length; r++) {
      const excelRow = excelWs.addRow(resultRows[r]);

      for (let c = 1; c <= colCount; c++) {
        const cell = excelRow.getCell(c);
        const numFmt = dateFormatFor(cell.value);
        if (numFmt) cell.numFmt = numFmt;
      }

      if (r > 0 && resultRows[r][detectedColIndex] === 'TRUE') {
        for (let c = 1; c <= colCount; c++) {
          excelRow.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' },
          };
        }
      }
    }

    totalDetectedCount += detectedCount;
    totalRowCount += rowCount;
  }

  const buffer = await excelWb.xlsx.writeBuffer();
  const resultData = new Uint8Array(buffer);

  self.postMessage(
    { type: 'result', id, name, outputPath, data: resultData },
    [resultData.buffer]
  );
  self.postMessage({
    type: 'log',
    message: `✅ Excel 변환 완료 | ${wb.SheetNames.length}개 시트, 전체 ${totalRowCount}행 중 탐지 ${totalDetectedCount}행`,
  });
}

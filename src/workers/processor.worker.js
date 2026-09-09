import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { findKeywordRectsAndKeywords, addOutlines, addHighlightAnnotation } from './lib/pdf-highlight.js';
import { buildPattern, buildCompactPattern, findKeywordsInRow } from './lib/keywords.js';
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

const queue = [];
let flushed = false;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'process') {
    queue.push(msg);
    if (flushed) await processNext();
  } else if (msg.type === 'flush') {
    flushed = true;
    await drainQueue();
  }
};

async function drainQueue() {
  while (queue.length > 0) await processNext();
  self.postMessage({ type: 'done' });
}

async function processNext() {
  const task = queue.shift();
  if (!task) return;
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
  const pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
  const pageHighlights = [];
  let totalFound = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const { rects, matchedKeywords } = findKeywordRectsAndKeywords(content.items, pattern, kwMap);
    if (rects.length > 0) {
      pageHighlights.push({ pageIndex: p - 1, rects, keywords: matchedKeywords });
      totalFound += rects.length;
    }
  }

  // Step 2: pdf-lib으로 하이라이트 + 북마크 추가
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(data);
  } catch (e) {
    if (String(e).includes('encrypted')) {
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

  // SheetJS로 읽기
  const wb = XLSX.read(data, { type: 'array' });

  const excelWb = new ExcelJS.Workbook();
  let totalDetectedCount = 0;
  let totalRowCount = 0;

  for (const wsName of wb.SheetNames) {
    const ws = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const rawHeader = rows[0] ?? [];

    // 이미 처리된 파일 재실행 시 기존 결과 컬럼 제거
    const removeIndices = new Set(
      rawHeader.map((h, i) => (h === '발견여부' || h === '발견된 단어') ? i : -1).filter(i => i >= 0)
    );
    const header = rawHeader.filter((_, i) => !removeIndices.has(i));

    const outputHeader = [...header, '발견여부', '발견된 단어'];
    const resultRows = [outputHeader];
    let detectedCount = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r].filter((_, i) => !removeIndices.has(i));
      const sorted = findKeywordsInRow(row, pattern, kwMap, detectConsecutiveSpaces);
      const detected = sorted.length > 0;
      if (detected) detectedCount++;
      resultRows.push([...row, detected ? 'TRUE' : 'FALSE', sorted.join(', ')]);
    }

    // ExcelJS로 시트 추가 (노란색 행 강조 포함)
    const detectedColIndex = outputHeader.indexOf('발견여부'); // 0-based
    const colCount = outputHeader.length;

    const excelWs = excelWb.addWorksheet(wsName);

    for (let r = 0; r < resultRows.length; r++) {
      const excelRow = excelWs.addRow(resultRows[r]);

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
    totalRowCount += resultRows.length - 1;
  }

  const buffer = await excelWb.xlsx.writeBuffer();
  const resultData = new Uint8Array(buffer);

  self.postMessage(
    { type: 'result', id, name, outputPath, data: resultData },
    [resultData.buffer]
  );
  self.postMessage({
    type: 'log',
    message: `✅ Excel 완료 | ${wb.SheetNames.length}개 시트, 전체 ${totalRowCount}행 중 탐지 ${totalDetectedCount}행 → ${outputPath}`,
  });
}

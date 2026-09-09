// 통합 테스트: 실제 PDF를 만들어 pdfjs로 읽고 → 하이라이트를 넣고 →
// 다시 pdfjs로 읽어 "정말 그려지는가"까지 확인한다.
//
// 단위 테스트만으로는 오늘 발견한 버그를 못 잡는다. 어노테이션은 정상적으로
// 들어가 있었고, 크기가 0이라 화면에 안 보였을 뿐이기 때문이다.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  PDFDocument, StandardFonts,
  beginText, endText, setFontAndSize, setTextMatrix, showText, setCharacterSpacing,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { findKeywordRectsAndKeywords, addHighlightAnnotation, addOutlines } from '../src/workers/lib/pdf-highlight.js';
import { buildCompactPattern } from '../src/workers/lib/keywords.js';

// Node에서 pdfjs는 이 값을 fs 경로로 읽는다. file:// URL은 못 읽고,
// 윈도우 역슬래시 경로는 "must include trailing slash"로 거부당한다.
const STANDARD_FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))
  .replaceAll('\\', '/');

const openPdf = bytes =>
  pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;

// 텍스트 행렬을 직접 써서 PDF를 만든다.
//
// pdf-lib의 drawText({ rotate: degrees(90) })를 쓰면 안 된다. cos(π/2)가 정확히
// 0이 아니라 8.6e-16이라, NEIS 문서의 진짜 행렬([0 s -s 0 e f])을 재현하지 못하고
// 오늘 버그를 그냥 통과시킨다.
const SIZE = 14;
async function makePdf({ lines, rotate = 0, charSpacing = 0 }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.setFont(font);
  const [, fontKey] = page.getFont();

  lines.forEach((text, i) => {
    // 텍스트 행렬은 단위 회전만 담고 크기는 Tf가 준다. 그래서 pdfjs가 보는
    // item.transform은 rotate=90일 때 정확히 [0 14 -14 0 x y] — 실제 NEIS 문서와 같다.
    // 회전 텍스트는 진행 방향이 +y라서 줄이 나뉘는 축도 x로 바뀐다.
    const matrix = rotate
      ? [0, 1, -1, 0, 40 + i * 40, 40]
      : [1, 0, 0, 1, 40, 240 - i * 40];
    page.pushOperators(
      beginText(),
      setCharacterSpacing(charSpacing),
      setFontAndSize(fontKey, SIZE),
      setTextMatrix(...matrix),
      showText(font.encodeText(text)),
      endText(),
    );
  });
  return await doc.save();
}

// 워커의 processPdf와 같은 순서로 돌린다 (파일 입출력만 뺀 것).
async function highlight(srcBytes, keywords) {
  const { pattern, kwMap } = buildCompactPattern(keywords);
  const src = await openPdf(srcBytes);

  const perPage = [];
  for (let p = 1; p <= src.numPages; p++) {
    const content = await (await src.getPage(p)).getTextContent();
    const { rects, matchedKeywords } = findKeywordRectsAndKeywords(content.items, pattern, kwMap);
    if (rects.length) perPage.push({ pageIndex: p - 1, rects, keywords: matchedKeywords });
  }

  const doc = await PDFDocument.load(srcBytes);
  for (const { pageIndex, rects } of perPage) {
    for (const quad of rects) addHighlightAnnotation(doc, doc.getPage(pageIndex), quad);
  }
  const outlines = perPage.flatMap(({ pageIndex, keywords: kws }) =>
    [...kws].map(kw => ({ title: `P${pageIndex + 1}: ${kw}`, pageIndex })),
  );
  if (outlines.length) addOutlines(doc, outlines);

  return { bytes: await doc.save(), found: perPage.reduce((n, p) => n + p.rects.length, 0) };
}

// 페이지를 실제로 그려서 노란 픽셀 수를 센다.
// 어노테이션이 "들어갔는가"가 아니라 "보이는가"를 검사하는 유일한 방법이다.
async function yellowPixels(bytes, pageNumber = 1) {
  const page = await (await openPdf(bytes)).getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport, annotationMode: 2 }).promise;

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] > 150 && data[i + 2] < 120) count++;
  }
  return count;
}

async function highlightsOf(bytes) {
  const pdf = await openPdf(bytes);
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const annots = await page.getAnnotations({ intent: 'display' });
    for (const a of annots.filter(a => a.subtype === 'Highlight')) {
      out.push({ ...a, view: page.view });
    }
  }
  return out;
}

const LINES = ['first line has toeic here', 'second line: TOEIC again'];

describe.each([
  ['가로 문서', 0],
  ['90도 회전 문서 (NEIS 형식)', 90],
])('%s', (_label, rotate) => {
  let src, result, annots;

  beforeAll(async () => {
    src = await makePdf({ lines: LINES, rotate });
    result = await highlight(src, ['toeic']);
    annots = await highlightsOf(result.bytes);
  });

  it('원본에는 하이라이트가 없다', async () => {
    expect(await highlightsOf(src)).toHaveLength(0);
  });

  it('찾은 단어 수만큼 하이라이트가 생긴다', () => {
    expect(result.found).toBe(2);
    expect(annots).toHaveLength(2);
  });

  // 이것이 오늘 버그의 핵심 방어선이다. 크기가 0이면 뷰어에서 안 보인다.
  it('모든 하이라이트의 가로·세로가 0이 아니다', () => {
    for (const a of annots) {
      const [x0, y0, x1, y1] = a.rect;
      expect(Math.abs(x1 - x0)).toBeGreaterThan(1);
      expect(Math.abs(y1 - y0)).toBeGreaterThan(1);
    }
  });

  it('모든 하이라이트가 페이지 안에 있다', () => {
    for (const a of annots) {
      const [x0, y0, x1, y1] = a.rect;
      const [vx0, vy0, vx1, vy1] = a.view;
      expect(x0).toBeGreaterThanOrEqual(vx0 - 1);
      expect(y0).toBeGreaterThanOrEqual(vy0 - 1);
      expect(x1).toBeLessThanOrEqual(vx1 + 1);
      expect(y1).toBeLessThanOrEqual(vy1 + 1);
    }
  });

  it('노란색으로 칠한다', () => {
    for (const a of annots) {
      expect(Array.from(a.color)).toEqual([255, 230, 0]);
    }
  });

  // 오늘 버그는 어노테이션이 정상적으로 들어간 채 화면에만 안 나왔다.
  // 그러니 마지막 관문은 "그려서 노란색이 나오는가"여야 한다.
  it('실제로 렌더링하면 노란색이 칠해진다', async () => {
    expect(await yellowPixels(src)).toBe(0);
    expect(await yellowPixels(result.bytes)).toBeGreaterThan(100);
  });

  it('페이지·키워드마다 북마크를 하나씩 만든다', async () => {
    const outline = await (await openPdf(result.bytes)).getOutline();
    // 두 군데서 찾았지만 같은 페이지의 같은 단어이므로 북마크는 하나다.
    expect(outline).toHaveLength(1);
    expect(outline[0].title).toBe('P1: toeic');
  });

  it('원본 텍스트를 건드리지 않는다', async () => {
    const before = await (await (await openPdf(src)).getPage(1)).getTextContent();
    const after = await (await (await openPdf(result.bytes)).getPage(1)).getTextContent();
    expect(after.items.map(i => i.str)).toEqual(before.items.map(i => i.str));
  });
});

describe('회전 여부와 무관한 동작', () => {
  it('가로 문서와 회전 문서의 하이라이트 면적이 비슷하다', async () => {
    const area = async rotate => {
      const { bytes } = await highlight(await makePdf({ lines: LINES, rotate }), ['toeic']);
      const [a] = await highlightsOf(bytes);
      return Math.abs(a.rect[2] - a.rect[0]) * Math.abs(a.rect[3] - a.rect[1]);
    };
    const [flat, rot] = [await area(0), await area(90)];
    expect(rot).toBeGreaterThan(flat * 0.9);
    expect(rot).toBeLessThan(flat * 1.1);
  });
});

describe('찾는 단어가 없을 때', () => {
  it('하이라이트도 북마크도 만들지 않는다', async () => {
    const { bytes, found } = await highlight(await makePdf({ lines: LINES }), ['존재하지않는단어']);
    expect(found).toBe(0);
    expect(await highlightsOf(bytes)).toHaveLength(0);
    expect(await (await openPdf(bytes)).getOutline()).toBeNull();
  });
});

describe('이미 하이라이트가 있는 PDF를 다시 처리할 때', () => {
  it('기존 하이라이트를 지우지 않고 쌓는다', async () => {
    const first = await highlight(await makePdf({ lines: LINES }), ['toeic']);
    const second = await highlight(first.bytes, ['toeic']);
    expect(await highlightsOf(second.bytes)).toHaveLength(4);
  });
});

// 회귀: pdfjs는 자간(Tc)이 임계값을 넘으면 item.str 안에 공백을 스스로
// 끼워 넣는다('TOEIC' → 'T O E I C'). 원문 그대로 매칭하던 시절에는
// 자간을 벌린 PDF에서 단어를 하나도 못 찾고 '탐지 0건'으로 끝났다.
// NEIS/HWP 문서는 표 칸에 글자를 맞추려고 자간을 흔히 조정한다.
describe('자간이 벌어진 PDF', () => {
  it('pdfjs가 글자 사이에 공백을 끼워 넣는 것을 실제로 확인한다', async () => {
    const pdf = await openPdf(await makePdf({ lines: ['gochul TOEIC sihum'], charSpacing: 3 }));
    const { items } = await (await pdf.getPage(1)).getTextContent();
    const raw = items.map(i => i.str).join('');
    expect(raw).not.toContain('TOEIC'); // 이 전제가 깨지면 아래 테스트는 무의미하다
  });

  it('자간이 벌어져도 단어를 찾아 하이라이트한다', async () => {
    const { bytes, found } = await highlight(
      await makePdf({ lines: ['gochul TOEIC sihum'], charSpacing: 3 }),
      ['TOEIC'],
    );
    expect(found).toBeGreaterThan(0);
    expect(await yellowPixels(bytes)).toBeGreaterThan(50);
  });

  it('자간이 벌어진 회전 텍스트에서도 찾는다', async () => {
    const { found } = await highlight(
      await makePdf({ lines: ['gochul TOEIC sihum'], rotate: 90, charSpacing: 3 }),
      ['TOEIC'],
    );
    expect(found).toBeGreaterThan(0);
  });
});

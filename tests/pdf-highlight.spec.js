import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFHexString } from 'pdf-lib';
import {
  findKeywordRectsAndKeywords,
  addHighlightAnnotation,
  addOutlines,
} from '../src/workers/lib/pdf-highlight.js';
import { buildCompactPattern } from '../src/workers/lib/keywords.js';

// pdfjs의 getTextContent() 아이템을 흉내낸다.
// transform = [a b c d e f] — (a,b)는 글자 진행 방향, (c,d)는 글자 위쪽 방향.
const horizontal = (str, { x = 0, y = 100, size = 10, width = null } = {}) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: width ?? str.length * size * 0.5,
  height: size,
});

// NEIS/HWP 가로 문서에서 실제로 쓰이는 형태: 90도 회전된 텍스트.
const rotated90 = (str, { x = 100, y = 0, size = 10, width = null } = {}) => ({
  str,
  transform: [0, size, -size, 0, x, y],
  width: width ?? str.length * size * 0.5,
  height: size,
});

const quadsFor = (items, keywords) => {
  const { pattern, kwMap } = buildCompactPattern(keywords);
  return findKeywordRectsAndKeywords(items, pattern, kwMap);
};

const bbox = quad => ({
  w: Math.max(...quad.map(p => p.x)) - Math.min(...quad.map(p => p.x)),
  h: Math.max(...quad.map(p => p.y)) - Math.min(...quad.map(p => p.y)),
});

describe('findKeywordRectsAndKeywords', () => {
  it('일치하는 단어가 없으면 사각형을 만들지 않는다', () => {
    const { rects, matchedKeywords } = quadsFor([horizontal('평범한 문장')], ['토익']);
    expect(rects).toEqual([]);
    expect([...matchedKeywords]).toEqual([]);
  });

  it('텍스트가 없으면 빈 결과', () => {
    expect(quadsFor([], ['토익']).rects).toEqual([]);
  });

  it('가로 텍스트에서 4개 꼭짓점을 만든다', () => {
    const { rects, matchedKeywords } = quadsFor([horizontal('나는 토익 시험')], ['토익']);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toHaveLength(4);
    expect([...matchedKeywords]).toEqual(['토익']);
  });

  it('가로 텍스트의 하이라이트 높이는 글자 크기에 비례한다', () => {
    const { h } = bbox(quadsFor([horizontal('토익', { size: 20 })], ['토익']).rects[0]);
    expect(h).toBeGreaterThan(20 * 0.9);
    expect(h).toBeLessThan(20 * 1.5); // 윗줄을 침범할 만큼 두꺼우면 안 된다
  });

  // ── 회귀 테스트 ────────────────────────────────────────────────
  // 예전 코드는 글자 크기를 Math.abs(transform[3])로 구했다. 90도 회전
  // 텍스트에서는 이 값이 0이라 두께 0짜리 사각형이 만들어져, 어노테이션은
  // 들어가지만 어떤 뷰어에서도 형광펜이 보이지 않았다.
  it('90도 회전된 텍스트에서도 두께가 0이 아니다', () => {
    const { rects } = quadsFor([rotated90('나는 토익 시험', { size: 12 })], ['토익']);
    expect(rects).toHaveLength(1);
    const { w, h } = bbox(rects[0]);
    expect(w).toBeGreaterThan(1);
    expect(h).toBeGreaterThan(1);
  });

  it('90도 회전된 텍스트의 하이라이트는 글자 진행 방향(y축)으로 길다', () => {
    const { rects } = quadsFor([rotated90('토익시험공부중', { size: 10 })], ['토익']);
    const { w, h } = bbox(rects[0]);
    expect(h).toBeGreaterThan(w); // 세로로 진행하므로 y 길이가 더 길다
    expect(w).toBeLessThan(10 * 1.5); // x 방향은 글자 크기 수준
  });

  it('회전 여부와 무관하게 하이라이트 크기가 같다', () => {
    const flat = bbox(quadsFor([horizontal('토익시험', { size: 12 })], ['토익']).rects[0]);
    const rot = bbox(quadsFor([rotated90('토익시험', { size: 12 })], ['토익']).rects[0]);
    expect(rot.w).toBeCloseTo(flat.h, 5);
    expect(rot.h).toBeCloseTo(flat.w, 5);
  });

  it('글자 크기를 구할 수 없으면 하이라이트를 건너뛴다', () => {
    const broken = { str: '토익', transform: [0, 0, 0, 0, 10, 10], width: 20, height: 0 };
    expect(quadsFor([broken], ['토익']).rects).toEqual([]);
  });

  it('하이라이트가 베이스라인 위아래를 모두 덮는다', () => {
    const [tl, , bl] = quadsFor([horizontal('토익', { y: 100, size: 10 })], ['토익']).rects[0];
    expect(tl.y).toBeGreaterThan(100); // 베이스라인 위
    expect(bl.y).toBeLessThan(100);    // 디센더까지 아래로
  });

  it('한 단어가 두 조각에 걸치면 조각마다 하이라이트를 만든다', () => {
    // pdfjs는 같은 줄이라도 글꼴/커닝 경계에서 텍스트를 나눈다.
    // 예전에는 조각 사이에 무조건 공백이 끼어서 키워드를 '토 익'으로 적어야
    // 통과했다 — 실제 단어 목록에는 '토익'이 들어 있으므로 못 찾는 상태였다.
    const items = [horizontal('토', { x: 0 }), horizontal('익', { x: 5 })];
    const { rects } = quadsFor(items, ['토익']);
    expect(rects).toHaveLength(2);
  });

  it('같은 페이지의 여러 단어를 모두 찾는다', () => {
    const { rects, matchedKeywords } = quadsFor(
      [horizontal('토익과 TOEFL 성적')],
      ['토익', 'TOEFL'],
    );
    expect(rects).toHaveLength(2);
    expect([...matchedKeywords].sort()).toEqual(['TOEFL', '토익']);
  });
});

describe('addHighlightAnnotation', () => {
  const quad = [
    { x: 10, y: 30 }, { x: 50, y: 30 }, // 좌상, 우상
    { x: 10, y: 20 }, { x: 50, y: 20 }, // 좌하, 우하
  ];

  const newDoc = async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    return doc;
  };

  const annotDictOf = page => page.node.Annots().lookup(0);

  it('Highlight 어노테이션을 페이지에 추가한다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);

    const annot = annotDictOf(page);
    expect(annot.get(PDFName.of('Subtype'))).toBe(PDFName.of('Highlight'));
    expect(page.node.Annots().size()).toBe(1);
  });

  it('Rect는 quad를 감싸는 사각형이고 넓이가 0이 아니다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);

    const rect = annotDictOf(page).lookup(PDFName.of('Rect')).asRectangle();
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(40);
    expect(rect.height).toBe(10);
  });

  it('QuadPoints를 8개 숫자로 기록한다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);
    expect(annotDictOf(page).lookup(PDFName.of('QuadPoints')).size()).toBe(8);
  });

  // 외형(AP)이 없으면 스스로 그려주지 않는 뷰어(맥 미리보기 등)와
  // 인쇄에서 형광펜이 사라진다.
  it('Appearance Stream(/AP /N)을 함께 넣는다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);

    const ap = annotDictOf(page).lookup(PDFName.of('AP'));
    expect(ap).toBeDefined();
    const form = ap.lookup(PDFName.of('N'));
    expect(form.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Form'));
    expect(form.dict.lookup(PDFName.of('BBox')).size()).toBe(4);
  });

  it('인쇄 플래그(F=4)를 켠다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);
    expect(annotDictOf(page).lookup(PDFName.of('F')).asNumber()).toBe(4);
  });

  it('기존 어노테이션을 지우지 않고 덧붙인다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    const link = doc.context.register(doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: doc.context.obj([0, 0, 10, 10]),
    }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([link]));

    addHighlightAnnotation(doc, page, quad);
    expect(page.node.Annots().size()).toBe(2);
  });

  // 회귀: /Annots 12 0 R 형태(간접참조)로 저장된 PDF가 흔하다.
  // page.node.get()은 참조 객체를 그대로 돌려주므로 .push()가 없어 터졌고,
  // 그 파일은 하이라이트도 북마크도 없이 통째로 실패했다.
  it('/Annots가 간접참조여도 터지지 않는다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    const arr = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), doc.context.register(arr));

    expect(() => addHighlightAnnotation(doc, page, quad)).not.toThrow();
    expect(page.node.Annots().size()).toBe(1);
  });

  it('여러 번 호출하면 그만큼 쌓인다', async () => {
    const doc = await newDoc();
    const page = doc.getPage(0);
    addHighlightAnnotation(doc, page, quad);
    addHighlightAnnotation(doc, page, quad);
    addHighlightAnnotation(doc, page, quad);
    expect(page.node.Annots().size()).toBe(3);
  });
});

describe('addOutlines', () => {
  const docWithPages = async n => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([200, 200]);
    return doc;
  };

  it('카탈로그에 Outlines를 건다', async () => {
    const doc = await docWithPages(2);
    addOutlines(doc, [{ title: 'P1: 토익', pageIndex: 0 }]);

    const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines.get(PDFName.of('Type'))).toBe(PDFName.of('Outlines'));
    expect(outlines.lookup(PDFName.of('Count')).asNumber()).toBe(1);
  });

  it('한글 제목을 UTF-16BE로 인코딩한다 (BOM 0xFEFF)', async () => {
    const doc = await docWithPages(1);
    addOutlines(doc, [{ title: '토익', pageIndex: 0 }]);

    const first = doc.catalog.lookup(PDFName.of('Outlines')).lookup(PDFName.of('First'));
    const title = first.lookup(PDFName.of('Title'));
    expect(title).toBeInstanceOf(PDFHexString);
    expect(title.toString().toLowerCase()).toContain('feff');
    expect(title.decodeText()).toBe('토익');
  });

  it('여러 항목을 Prev/Next로 잇는다', async () => {
    const doc = await docWithPages(3);
    addOutlines(doc, [
      { title: 'P1: 토익', pageIndex: 0 },
      { title: 'P2: 토플', pageIndex: 1 },
      { title: 'P3: 텝스', pageIndex: 2 },
    ]);

    const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines.lookup(PDFName.of('Count')).asNumber()).toBe(3);

    const first = outlines.lookup(PDFName.of('First'));
    expect(first.get(PDFName.of('Prev'))).toBeUndefined();

    const second = first.lookup(PDFName.of('Next'));
    expect(second.lookup(PDFName.of('Title')).decodeText()).toBe('P2: 토플');
    expect(second.get(PDFName.of('Prev'))).toBeDefined();

    const third = second.lookup(PDFName.of('Next'));
    expect(third.get(PDFName.of('Next'))).toBeUndefined();
  });

  it('각 항목이 해당 페이지를 가리킨다', async () => {
    const doc = await docWithPages(3);
    addOutlines(doc, [{ title: 'P3: 토익', pageIndex: 2 }]);

    const first = doc.catalog.lookup(PDFName.of('Outlines')).lookup(PDFName.of('First'));
    const dest = first.lookup(PDFName.of('Dest'), PDFArray);
    expect(dest.get(0)).toBe(doc.getPage(2).ref);
  });
});

// 회귀: 예전에는 아이템 사이에 무조건 공백 1칸을 넣었다. 그래서 한 단어가
// 두 아이템으로 쪼개지면('토'+'익') '토 익'이 되어 영영 못 찾았고, 반대로
// 서로 무관한 두 칸의 끝과 시작이 이어 붙어 공백 포함 키워드를 오탐했다.
describe('아이템 경계 처리', () => {
  const eol = item => ({ ...item, hasEOL: true });

  it('같은 줄에서 두 조각으로 쪼개진 단어를 찾는다', () => {
    const items = [horizontal('토', { x: 0 }), horizontal('익', { x: 5 })];
    const { rects, matchedKeywords } = quadsFor(items, ['토익']);
    expect([...matchedKeywords]).toEqual(['토익']);
    expect(rects).toHaveLength(2); // 조각마다 하나씩
  });

  it('줄바꿈으로 쪼개진 단어를 찾는다', () => {
    const items = [
      eol(horizontal('성적이 좋아 토', { x: 0, y: 100 })),
      horizontal('익 응시함', { x: 0, y: 80 }),
    ];
    expect([...quadsFor(items, ['토익']).matchedKeywords]).toEqual(['토익']);
  });

  it('공백 포함 키워드는 같은 줄에서 정상 매칭된다', () => {
    const { rects } = quadsFor([horizontal('교내 대회 참가함')], ['대회 참가']);
    expect(rects).toHaveLength(1);
  });

  it('공백 포함 키워드를 줄 경계 너머로 오탐하지 않는다', () => {
    // '…교내 대회' / '참가하여…' 가 이어 붙어 '대회 참가'가 되면 안 된다.
    const items = [
      eol(horizontal('교내 대회', { x: 0, y: 100 })),
      horizontal('참가하여', { x: 0, y: 80 }),
    ];
    expect(quadsFor(items, ['대회 참가']).rects).toEqual([]);
  });

  it('공백 포함 키워드를 옆 칸 너머로 오탐하지 않는다', () => {
    // 같은 줄이지만 표의 다른 칸 — 진행 방향으로 멀리 떨어져 있다.
    const items = [
      horizontal('교내 대회', { x: 0, y: 100 }),
      horizontal('참가하여', { x: 300, y: 100 }),
    ];
    expect(quadsFor(items, ['대회 참가']).rects).toEqual([]);
  });

  it('자간 때문에 아이템 안에 낀 공백을 무시하고 찾는다', () => {
    // pdfjs가 Tc를 보고 'ㅌ ㅗ ㅇ ㅣ ㄱ'처럼 글자마다 공백을 끼워 넣은 상태.
    const { rects } = quadsFor([horizontal('가 토 익 나')], ['토익']);
    expect(rects).toHaveLength(1);
  });

  it('조합형(NFD) 본문에서도 찾는다', () => {
    const { matchedKeywords } = quadsFor([horizontal('토익 응시'.normalize('NFD'))], ['토익']);
    expect([...matchedKeywords]).toEqual(['토익']);
  });

  it('회전 텍스트에서도 줄 경계 오탐을 막는다', () => {
    const items = [
      eol(rotated90('교내 대회', { x: 100, y: 0 })),
      rotated90('참가하여', { x: 80, y: 0 }),
    ];
    expect(quadsFor(items, ['대회 참가']).rects).toEqual([]);
  });
});

// 회귀: /Outlines를 조건 없이 덮어써서, 원본 PDF에 들어 있던 목차가
// 결과 파일에서 통째로 사라졌다. NEIS 출력물·병합본에는 학생별/영역별
// 북마크가 들어 있다. 하이라이트는 기존 것을 보존하는데 북마크만 파괴적이었다.
describe('addOutlines — 기존 북마크 보존', () => {
  const makeDoc = async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    return doc;
  };

  const topLevelTitles = (doc) => {
    const { context, catalog } = doc;
    const root = context.lookup(catalog.get(PDFName.of('Outlines')));
    const titles = [];
    let cursor = root.get(PDFName.of('First'));
    while (cursor) {
      const node = context.lookup(cursor);
      if (!node) break;
      titles.push(node.get(PDFName.of('Title')).decodeText());
      cursor = node.get(PDFName.of('Next'));
    }
    return titles;
  };

  it('기존 북마크가 없으면 새로 만든다', async () => {
    const doc = await makeDoc();
    const result = addOutlines(doc, [{ title: 'P1: 토익', pageIndex: 0 }]);
    expect(result.preserved).toBe(0);
    expect(topLevelTitles(doc)).toEqual(['P1: 토익']);
  });

  it('기존 북마크 뒤에 이어 붙인다', async () => {
    const doc = await makeDoc();
    addOutlines(doc, [{ title: '학생 A', pageIndex: 0 }, { title: '학생 B', pageIndex: 1 }]);

    const result = addOutlines(doc, [{ title: 'P1: 토익', pageIndex: 0 }]);

    expect(result.preserved).toBe(2);
    expect(topLevelTitles(doc)).toEqual(['학생 A', '학생 B', 'P1: 토익']);
  });

  it('이어 붙인 뒤 Count가 최상위 항목 수와 맞는다', async () => {
    const doc = await makeDoc();
    addOutlines(doc, [{ title: '학생 A', pageIndex: 0 }]);
    addOutlines(doc, [{ title: 'P1: 토익', pageIndex: 0 }, { title: 'P2: 토플', pageIndex: 1 }]);

    const root = doc.context.lookup(doc.catalog.get(PDFName.of('Outlines')));
    expect(root.get(PDFName.of('Count')).asNumber()).toBe(3);
    expect(topLevelTitles(doc)).toHaveLength(3);
  });

  it('앞뒤 항목이 Prev/Next로 제대로 이어진다', async () => {
    const doc = await makeDoc();
    addOutlines(doc, [{ title: '학생 A', pageIndex: 0 }]);
    addOutlines(doc, [{ title: 'P1: 토익', pageIndex: 0 }]);

    const { context, catalog } = doc;
    const root = context.lookup(catalog.get(PDFName.of('Outlines')));
    const first = context.lookup(root.get(PDFName.of('First')));
    const last = context.lookup(root.get(PDFName.of('Last')));

    expect(first.get(PDFName.of('Title')).decodeText()).toBe('학생 A');
    expect(last.get(PDFName.of('Title')).decodeText()).toBe('P1: 토익');
    expect(context.lookup(first.get(PDFName.of('Next')))).toBe(last);
    expect(context.lookup(last.get(PDFName.of('Prev')))).toBe(first);
  });
});

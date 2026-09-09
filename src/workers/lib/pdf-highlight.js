// PDF 하이라이트/북마크 생성 로직 (순수 함수 — Worker 밖에서도 테스트 가능)
import { PDFName, PDFNumber, PDFHexString } from 'pdf-lib';
import { toMatchForm } from './keywords.js';

// 두 아이템 사이가 "이어지는 글"이 아니라 다른 덩어리(줄바꿈, 옆 칸)인가.
//
// 예전에는 아이템 사이에 무조건 공백 1칸을 넣었다. 그래서 (1) 한 단어가 두
// 아이템으로 쪼개지면 '토 익'이 되어 못 찾고, (2) 표의 옆 칸이나 다음 줄의
// 끝과 시작이 이어 붙어 '대회 참가' 같은 공백 포함 키워드를 오탐했다.
function breaksBlock(prev, next) {
  if (prev.hasEOL) return true;

  const size = prev.fontSize || next.fontSize;
  if (!(size > 0)) return true;

  // 글자 진행 방향이 다르면(회전 텍스트 경계) 다른 덩어리로 본다.
  if (prev.ux * next.ux + prev.uy * next.uy < 0.99) return true;

  // prev의 끝점 → next의 시작점 변위를 진행 방향/위 방향으로 분해한다.
  const dx = next.x - (prev.x + prev.ux * prev.width);
  const dy = next.y - (prev.y + prev.uy * prev.width);
  const along = dx * prev.ux + dy * prev.uy;
  const perp = dx * prev.vx + dy * prev.vy;

  if (Math.abs(perp) > size * 0.5) return true;   // 줄이 다르다
  return Math.abs(along) > size * 1.5;            // 같은 줄이지만 멀리 떨어졌다
}

// 텍스트 아이템 목록에서 키워드 위치와 원본 키워드 Set을 반환
//
// pattern/kwMap은 buildCompactPattern()이 만든 것이어야 한다 — 본문도
// 키워드도 공백을 지운 형태로 맞춘다.
export function findKeywordRectsAndKeywords(items, pattern, kwMap) {
  const segments = items
    .filter(item => item.str)
    .map(item => {
      // 텍스트 행렬 [a b c d e f]: (a,b)=진행 방향, (c,d)=글자 위쪽 방향
      // 회전된 텍스트(예: [0 s -s 0 e f])에서도 올바른 크기/방향을 얻는다.
      const [a, b, c, d, e, f] = item.transform;
      const advLen = Math.hypot(a, b);
      const fontSize = Math.hypot(c, d) || Math.abs(item.height) || 0;
      return {
        text: item.str,
        hasEOL: item.hasEOL === true,
        x: e,
        y: f,
        width: item.width,
        fontSize,
        // 진행 방향 단위벡터
        ux: advLen ? a / advLen : 1,
        uy: advLen ? b / advLen : 0,
        // 위쪽 단위벡터
        vx: fontSize ? c / fontSize : 0,
        vy: fontSize ? d / fontSize : 1,
      };
    });

  if (segments.length === 0) return { rects: [], matchedKeywords: new Set() };

  // 공백을 지운 본문 + 위치 맵 구성.
  // blockIdx는 "이어지는 글" 단위다 — 서로 다른 blockIdx를 이어 붙여 만든
  // 매칭은 공백 포함 키워드일 때 버린다(옆 칸끼리 이어 붙는 오탐 방지).
  let compact = '';
  const posMap = [];
  let blockIdx = 0;

  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && breaksBlock(segments[i - 1], segments[i])) blockIdx++;

    const seg = segments[i];
    // NFC 정규화로 글자 수가 바뀔 수 있다(조합형 → 완성형). 기하 계산은
    // 원본 글자 인덱스 기준이므로 비례 환산해 되돌린다.
    const norm = toMatchForm(seg.text);
    const scale = seg.text.length / (norm.length || 1);

    for (let j = 0; j < norm.length; j++) {
      if (/\s/.test(norm[j])) continue; // pdfjs가 자간 때문에 넣은 공백 포함
      const charIdx = Math.min(seg.text.length - 1, Math.floor(j * scale));
      posMap.push({ segIdx: i, charIdx, blockIdx });
      compact += norm[j];
    }
  }

  const rects = [];
  const matchedKeywords = new Set();

  for (const match of compact.matchAll(pattern)) {
    const originalKw = kwMap.get(match[0].toLowerCase()) ?? match[0];

    const start = match.index;
    const end = start + match[0].length;

    // 공백이 든 키워드가 덩어리 경계를 넘어 매칭됐다면, 서로 무관한 두 칸을
    // 이어 붙여 만들어진 것이다 — 하이라이트하지 않는다.
    if (/\s/.test(originalKw) && posMap[start].blockIdx !== posMap[end - 1].blockIdx) continue;

    const segGroups = new Map();
    for (let ci = start; ci < end; ci++) {
      const pos = posMap[ci];
      if (!pos) continue;
      const { segIdx, charIdx } = pos;
      if (!segGroups.has(segIdx)) {
        segGroups.set(segIdx, { minChar: charIdx, maxChar: charIdx });
      } else {
        const g = segGroups.get(segIdx);
        g.minChar = Math.min(g.minChar, charIdx);
        g.maxChar = Math.max(g.maxChar, charIdx);
      }
    }

    for (const [segIdx, { minChar, maxChar }] of segGroups) {
      const seg = segments[segIdx];
      if (!(seg.fontSize > 0)) continue; // 글자 크기를 못 구하면 하이라이트 생략

      const charCount = seg.text.length || 1;
      const advStart = seg.width * (minChar / charCount) - seg.fontSize * 0.08;
      const advEnd   = seg.width * ((maxChar + 1) / charCount) + seg.fontSize * 0.08;
      const above = seg.fontSize * 0.88;  // 베이스라인 위(어센더)
      const below = seg.fontSize * 0.26;  // 베이스라인 아래(디센더)

      // 텍스트 방향을 따라 네 꼭짓점 계산 (회전 텍스트 대응)
      const at = (adv, up) => ({
        x: seg.x + seg.ux * adv + seg.vx * up,
        y: seg.y + seg.uy * adv + seg.vy * up,
      });

      rects.push([
        at(advStart, above),  // 좌상
        at(advEnd,   above),  // 우상
        at(advStart, -below), // 좌하
        at(advEnd,   -below), // 우하
      ]);
      // rect 생성 성공 시에만 키워드 등록 (rect 없는 매칭이 북마크에 포함되는 것 방지)
      matchedKeywords.add(originalKw);
    }
  }

  return { rects, matchedKeywords };
}

// pdf-lib으로 PDF 북마크(Outlines) 추가
export function addOutlines(pdfDoc, items) {
  const { context, catalog } = pdfDoc;

  // 한글 등 유니코드 타이틀 → UTF-16 BE HexString (PDF 스펙)
  function pdfTitle(str) {
    const bytes = [0xFE, 0xFF];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      bytes.push((c >> 8) & 0xFF, c & 0xFF);
    }
    return PDFHexString.of(bytes.map(b => b.toString(16).padStart(2, '0')).join(''));
  }

  const itemDicts = items.map(({ title, pageIndex }) => {
    const pageRef = pdfDoc.getPage(pageIndex).ref;
    return context.obj({
      Title: pdfTitle(title),
      Dest: context.obj([pageRef, PDFName.of('XYZ'), null, null, null]),
    });
  });

  const itemRefs = itemDicts.map(d => context.register(d));

  const rootDict = context.obj({
    Type: PDFName.of('Outlines'),
    First: itemRefs[0],
    Last: itemRefs[itemRefs.length - 1],
    Count: PDFNumber.of(items.length),
  });
  const rootRef = context.register(rootDict);

  for (let i = 0; i < itemDicts.length; i++) {
    itemDicts[i].set(PDFName.of('Parent'), rootRef);
    if (i > 0) itemDicts[i].set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < itemDicts.length - 1) itemDicts[i].set(PDFName.of('Next'), itemRefs[i + 1]);
  }

  catalog.set(PDFName.of('Outlines'), rootRef);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export const HIGHLIGHT_RGB = [1, 0.9, 0]; // 노란색 (R G B, 0~1)

// 뷰어가 외형(AP)을 자동 생성하지 않아도 보이도록 Appearance Stream을 직접 생성
function buildHighlightAppearance(context, quad, rect) {
  const n = v => v.toFixed(2);
  const [tl, tr, bl, br] = quad;
  const ops = [
    '/GS gs',
    `${HIGHLIGHT_RGB.join(' ')} rg`,
    `${n(tl.x)} ${n(tl.y)} m`,
    `${n(tr.x)} ${n(tr.y)} l`,
    `${n(br.x)} ${n(br.y)} l`,
    `${n(bl.x)} ${n(bl.y)} l`,
    'f',
  ].join('\n');

  const gsRef = context.register(context.obj({
    Type: 'ExtGState',
    BM: PDFName.of('Multiply'), // 아래 글자가 비쳐 보이도록
    ca: 1,
    CA: 1,
  }));

  return context.register(context.flateStream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: context.obj(rect),
    Resources: context.obj({ ExtGState: context.obj({ GS: gsRef }) }),
  }));
}

// pdf-lib으로 Highlight 어노테이션 추가
// quad: [좌상, 우상, 좌하, 우하] (PDF 스펙 QuadPoints 순서)
export function addHighlightAnnotation(pdfDoc, page, quad) {
  const { context } = pdfDoc;

  const xs = quad.map(p => p.x);
  const ys = quad.map(p => p.y);
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

  const annot = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Highlight'),
    Rect: context.obj(rect),
    QuadPoints: context.obj(quad.flatMap(p => [p.x, p.y])),
    C: context.obj(HIGHLIGHT_RGB),
    F: PDFNumber.of(4), // Print 플래그
    AP: context.obj({ N: buildHighlightAppearance(context, quad, rect) }),
  });

  const annotRef = context.register(annot);

  // /Annots 가 간접참조(예: /Annots 12 0 R)인 PDF도 있으므로 반드시 lookup 사용
  const annots = page.node.Annots();
  if (annots) {
    annots.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  }
}

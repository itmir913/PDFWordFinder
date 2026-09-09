// 검색 단어 매칭 로직 (순수 함수 — Worker 밖에서도 테스트 가능)

export const CONSEC_SPACE_LABEL = '연속 공백';

// 공백이 2~5칸 연달아 있는가.
//
// 예전에는 lookbehind를 쓴 정규식 리터럴 하나로 판정했다. lookbehind는
// Safari 16.4(macOS 13.3) 이상에서만 파싱되고, 리터럴이라 지원하지 않는
// WKWebView에서는 이 모듈 자체가 SyntaxError로 로드에 실패한다 — 연속 공백
// 검사만이 아니라 PDF·Excel 처리가 통째로 죽는다.
// 지금은 / +/g로 최대 길이 공백 덩어리를 훑어 같은 판정을 한다.
//
// 6칸 이상은 표 정렬용 여백으로 보고 넘어간다 — 예전 동작 그대로다.
// 여백 문자는 ASCII 스페이스만이 아니다. 한글 문서에는 전각 공백(U+3000)이,
// 웹에서 붙여 넣은 텍스트에는 NBSP(U+00A0)가 흔히 섞인다 — 내용을 여백으로
// 감추는 사례를 잡는 게 목적이므로 이들도 같이 센다.
const SPACE_RUN = new RegExp(`[ \\t${String.fromCharCode(0x00a0, 0x3000)}]+`, 'g');

export function hasConsecutiveSpaces(text) {
  for (const run of String(text).matchAll(SPACE_RUN)) {
    if (run[0].length >= 2 && run[0].length <= 5) return true;
  }
  return false;
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 한글은 완성형(NFC, '한' = 1코드포인트)과 조합형(NFD, 'ᄒ'+'ᅡ'+'ᆫ')이
// 눈에는 같지만 코드포인트가 완전히 다르다. macOS에서 만든 CSV나 PDF가
// 조합형을 내놓으면 오류 없이 탐지 0건이 된다 — 양쪽 다 NFC로 맞춰서 본다.
export function toMatchForm(text) {
  return String(text).normalize('NFC');
}

// 키워드 배열 → { pattern, kwMap }
// kwMap: lowercase(NFC keyword) → 원본 keyword (북마크/발견단어 표시용)
//
// 긴 단어를 먼저 정렬하는 이유: 정규식 교대(|)는 앞쪽 우선이라
// ['토익', '토익스피킹'] 순서면 '토익스피킹'이 영원히 '토익'으로만 잡힌다.
export function buildPattern(keywords) {
  const entries = keywords
    .map(kw => ({ original: kw, key: toMatchForm(kw) }))
    .filter(({ key }) => key.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  // 빈 목록으로 new RegExp('')를 만들면 모든 위치에 매칭된다 —
  // 문서 전체가 탐지되는 것보다 아무것도 안 잡는 쪽이 안전하다.
  if (entries.length === 0) return { pattern: /(?!)/g, kwMap: new Map() };

  const pattern = new RegExp(entries.map(({ key }) => escapeRegex(key)).join('|'), 'gi');
  const kwMap = new Map(entries.map(({ key, original }) => [key.toLowerCase(), original]));
  return { pattern, kwMap };
}

// 셀 한 줄에서 발견된 원본 키워드를 가나다순으로 반환 (Excel 처리용)
export function findKeywordsInRow(cells, pattern, kwMap, detectConsecutiveSpaces = false) {
  const foundSet = new Set();

  // 셀 단위 독립 매칭
  for (const cell of cells) {
    for (const match of toMatchForm(cell).matchAll(pattern)) {
      foundSet.add(kwMap.get(match[0].toLowerCase()) ?? match[0]);
    }
  }

  if (detectConsecutiveSpaces && cells.some(hasConsecutiveSpaces)) {
    foundSet.add(CONSEC_SPACE_LABEL);
  }

  return [...foundSet].sort((a, b) => a.localeCompare(b, 'ko'));
}

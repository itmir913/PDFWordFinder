import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPattern,
  escapeRegex,
  findKeywordsInRow,
  hasConsecutiveSpaces,
  toMatchForm,
  CONSEC_SPACE_LABEL,
} from '../src/workers/lib/keywords.js';

// 본문도 키워드도 NFC로 맞춰서 보는 것이 실제 매칭 경로의 계약이다.
const matches = (text, keywords) => {
  const { pattern, kwMap } = buildPattern(keywords);
  return [...toMatchForm(text).matchAll(pattern)].map(m => kwMap.get(m[0].toLowerCase()) ?? m[0]);
};

describe('escapeRegex', () => {
  it('정규식 메타문자를 리터럴로 만든다', () => {
    expect(new RegExp(escapeRegex('C++')).test('C++')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });

  it('메타문자가 든 단어를 정상 탐지한다', () => {
    expect(matches('C++ 수업을 들었다', ['C++'])).toEqual(['C++']);
    expect(matches('(주)회사', ['(주)'])).toEqual(['(주)']);
  });
});

describe('buildPattern', () => {
  it('대소문자를 구분하지 않는다', () => {
    expect(matches('toeic TOEIC ToEiC', ['TOEIC'])).toEqual(['TOEIC', 'TOEIC', 'TOEIC']);
  });

  it('원본 표기를 kwMap으로 되돌린다', () => {
    const { kwMap } = buildPattern(['TOEIC']);
    expect(kwMap.get('toeic')).toBe('TOEIC');
  });

  // 회귀: 짧은 단어가 먼저 오면 긴 단어가 영원히 잘린 채로만 잡힌다.
  it('긴 단어를 짧은 단어보다 먼저 매칭한다 (등록 순서 무관)', () => {
    expect(matches('토익스피킹 응시', ['토익', '토익스피킹'])).toEqual(['토익스피킹']);
    expect(matches('토익스피킹 응시', ['토익스피킹', '토익'])).toEqual(['토익스피킹']);
  });

  it('한 단어가 여러 번 나오면 모두 잡는다', () => {
    expect(matches('토익 그리고 토익', ['토익'])).toHaveLength(2);
  });
});

describe('findKeywordsInRow', () => {
  const { pattern, kwMap } = buildPattern(['토익', 'TOEFL']);

  it('여러 셀에 걸친 발견 단어를 중복 없이 모은다', () => {
    // 한글/라틴 혼합 정렬 순서는 플랫폼 ICU에 따라 달라지므로 집합으로만 본다.
    const found = findKeywordsInRow(['토익 준비', '토익 재응시', 'TOEFL'], pattern, kwMap);
    expect([...found].sort()).toEqual(['TOEFL', '토익']);
  });

  it('발견 단어가 없으면 빈 배열', () => {
    expect(findKeywordsInRow(['평범한 내용'], pattern, kwMap)).toEqual([]);
  });

  it('숫자·null 셀도 문자열로 취급한다', () => {
    // 반환값까지 단언한다 — not.toThrow()만으로는 항상 []를 돌려줘도 통과한다.
    expect(findKeywordsInRow([1, null, undefined, ''], pattern, kwMap)).toEqual([]);
  });

  it('가나다순으로 정렬한다', () => {
    const { pattern: p, kwMap: k } = buildPattern(['하늘', '가방', '나무']);
    expect(findKeywordsInRow(['하늘 나무 가방'], p, k)).toEqual(['가방', '나무', '하늘']);
  });

  describe('연속 공백 검사', () => {
    it('옵션이 꺼져 있으면 검사하지 않는다', () => {
      expect(findKeywordsInRow(['앞    뒤'], pattern, kwMap, false)).toEqual([]);
    });

    it('2~5칸 연속 공백을 잡는다', () => {
      expect(findKeywordsInRow(['앞  뒤'], pattern, kwMap, true)).toEqual([CONSEC_SPACE_LABEL]);
      expect(findKeywordsInRow(['앞     뒤'], pattern, kwMap, true)).toEqual([CONSEC_SPACE_LABEL]);
    });

    it('공백 1칸은 잡지 않는다', () => {
      expect(findKeywordsInRow(['앞 뒤'], pattern, kwMap, true)).toEqual([]);
    });

    it('6칸 이상은 잡지 않는다 (표 정렬용 여백)', () => {
      expect(findKeywordsInRow(['앞      뒤'], pattern, kwMap, true)).toEqual([]);
    });

    // 회귀: 예전 구현은 모듈 수준 /g 정규식에 test()를 써서 lastIndex가
    // 전진했다. 초기화를 빠뜨리면 두 번째 행부터 결과가 어긋난다.
    it('여러 행을 연속 검사해도 결과가 흔들리지 않는다', () => {
      for (let i = 0; i < 5; i++) {
        expect(findKeywordsInRow(['앞  뒤'], pattern, kwMap, true)).toEqual([CONSEC_SPACE_LABEL]);
      }
    });
  });
});

describe('hasConsecutiveSpaces', () => {
  it.each([
    ['앞 뒤', false, '1칸'],
    ['앞  뒤', true, '2칸'],
    ['앞   뒤', true, '3칸'],
    ['앞     뒤', true, '5칸'],
    ['앞      뒤', false, '6칸 — 표 정렬용 여백'],
    ['앞뒤', false, '공백 없음'],
    ['  앞뒤', true, '문장 맨 앞'],
    ['앞뒤  ', true, '문장 맨 뒤'],
    ['앞      뒤  중간', true, '6칸 뒤에 2칸이 또 있으면 잡는다'],
  ])('%s → %s (%s)', (text, expected) => {
    expect(hasConsecutiveSpaces(text)).toBe(expected);
  });

  it('문자열이 아닌 값도 받는다', () => {
    expect(hasConsecutiveSpaces(123)).toBe(false);
    expect(hasConsecutiveSpaces(null)).toBe(false);
    expect(hasConsecutiveSpaces(undefined)).toBe(false);
  });

  // 회귀: lookbehind는 Safari 16.4(macOS 13.3) 미만 WKWebView에서
  // 파싱 시점 SyntaxError다. 정규식 리터럴이라 그 엔진에서는 이 모듈이
  // 통째로 로드에 실패하고, PDF·Excel 처리가 전부 죽는다.
  it('워커 로직에 lookbehind 정규식이 없다', () => {
    // 파일 목록을 하드코딩하면 새로 추가된 모듈이 검사에서 샌다.
    const dir = fileURLToPath(new URL('../src/workers/lib/', import.meta.url));
    const files = readdirSync(dir).filter(f => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(dir + file, 'utf8');
      expect(source, `${file}에 lookbehind가 있다`).not.toMatch(/\(\?<[=!]/);
    }
  });
});

// 회귀: 완성형(NFC)과 조합형(NFD) 한글은 눈에 같지만 코드포인트가 다르다.
// macOS에서 만든 CSV/PDF가 조합형을 내놓으면 오류 없이 탐지 0건이 됐다.
describe('유니코드 정규화 (NFC/NFD)', () => {
  const nfd = str => str.normalize('NFD');

  it('조합형 본문에서 완성형 키워드를 찾는다', () => {
    expect(matches(nfd('토익 응시'), ['토익'])).toEqual(['토익']);
  });

  it('완성형 본문에서 조합형 키워드를 찾는다', () => {
    expect(matches('토익 응시', [nfd('토익')])).toHaveLength(1);
  });

  it('조합형 키워드를 찾아도 원본 표기로 돌려준다', () => {
    const { pattern, kwMap } = buildPattern(['토익']);
    expect(findKeywordsInRow([nfd('토익 준비')], pattern, kwMap)).toEqual(['토익']);
  });

  it('조합형 셀에서도 단어를 찾는다', () => {
    const { pattern, kwMap } = buildPattern(['토익', 'TOEFL']);
    // 정렬 순서는 플랫폼 ICU에 달렸으므로 집합만 본다.
    const found = findKeywordsInRow([nfd('토익 준비'), nfd('TOEFL 성적')], pattern, kwMap);
    expect([...found].sort()).toEqual(['TOEFL', '토익']);
  });
});

describe('buildPattern — 빈 목록', () => {
  it('키워드가 없으면 아무것도 매칭하지 않는다', () => {
    // new RegExp('')는 모든 위치에 매칭된다 — 문서 전체가 탐지되는 사고를 막는다.
    expect(matches('아무 내용이나', [])).toEqual([]);
  });

  it('빈 문자열·공백만 있는 키워드는 버린다', () => {
    expect(matches('아무 내용이나', ['', '   '])).toEqual([]);
  });
});

// 회귀: / +/g는 ASCII 스페이스만 셌다. 한글 문서의 전각 공백(U+3000)과
// 웹에서 붙여 넣은 NBSP(U+00A0)는 여백으로 내용을 감추는 흔한 수단인데
// 검사에서 통째로 빠져 있었다.
describe('hasConsecutiveSpaces — ASCII 아닌 여백', () => {
  const NBSP = String.fromCharCode(0x00a0);
  const FULLWIDTH = String.fromCharCode(0x3000);

  it('전각 공백 2칸을 잡는다', () => {
    expect(hasConsecutiveSpaces(`가${FULLWIDTH}${FULLWIDTH}나`)).toBe(true);
  });

  it('NBSP 2칸을 잡는다', () => {
    expect(hasConsecutiveSpaces(`가${NBSP}${NBSP}나`)).toBe(true);
  });

  it('탭 2칸을 잡는다', () => {
    expect(hasConsecutiveSpaces('가		나')).toBe(true);
  });

  it('섞여 있어도 잡는다', () => {
    expect(hasConsecutiveSpaces(`가 ${NBSP}나`)).toBe(true);
  });

  it('한 칸은 잡지 않는다', () => {
    expect(hasConsecutiveSpaces(`가${FULLWIDTH}나`)).toBe(false);
  });

  it('6칸 이상(표 정렬용 여백)은 그대로 넘어간다', () => {
    expect(hasConsecutiveSpaces(`가${FULLWIDTH.repeat(6)}나`)).toBe(false);
  });
});

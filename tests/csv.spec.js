import { describe, it, expect } from 'vitest';
import { decodeCsvBytes, parseKeywords } from '../src/lib/csv.js';

const utf8 = str => new TextEncoder().encode(str);
// 한국 윈도우 Excel이 CSV를 저장할 때 쓰는 CP949 바이트열.
const cp949 = bytes => new Uint8Array(bytes);

describe('decodeCsvBytes', () => {
  it('UTF-8을 그대로 읽는다', () => {
    expect(decodeCsvBytes(utf8('keyword\n토익'))).toEqual({
      text: 'keyword\n토익',
      encoding: 'utf-8',
    });
  });

  it('BOM이 붙은 UTF-8도 UTF-8로 판정한다', () => {
    const { encoding } = decodeCsvBytes(utf8('﻿keyword\n토익'));
    expect(encoding).toBe('utf-8');
  });

  // 회귀: 예전에는 TextDecoder('utf-8') 고정이라 CP949 CSV가 깨진 글자로
  // 들어오고, 에러 없이 "로드 완료"가 뜬 채 아무 단어도 안 잡혔다.
  it('CP949(EUC-KR) CSV를 알아보고 제대로 읽는다', () => {
    // 'keyword\n토익' — 한글 부분이 CP949
    const bytes = cp949([
      0x6b, 0x65, 0x79, 0x77, 0x6f, 0x72, 0x64, 0x0a,
      0xc5, 0xe4, 0xc0, 0xcd,
    ]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'keyword\n토익', encoding: 'euc-kr' });
  });

  it('CP949를 읽을 때 대체문자(U+FFFD)를 남기지 않는다', () => {
    const { text } = decodeCsvBytes(cp949([0xc5, 0xe4, 0xc0, 0xcd]));
    expect(text).not.toContain('�');
  });

  it('ArrayBuffer로 받아도 동작한다', () => {
    expect(decodeCsvBytes(utf8('keyword\n토익').buffer).text).toBe('keyword\n토익');
  });

  it('일반 배열(Tauri IPC가 주는 형태)로 받아도 동작한다', () => {
    expect(decodeCsvBytes([...utf8('keyword\n토익')]).text).toBe('keyword\n토익');
  });

  it('어느 인코딩으로도 못 읽으면 unknown으로 알린다', () => {
    // 0xFF는 UTF-8 선두 바이트로도, EUC-KR 선두 바이트(0x81~0xFE)로도 무효다.
    const { encoding } = decodeCsvBytes(cp949([0xff, 0xff]));
    expect(encoding).toBe('unknown');
  });

  it('빈 파일도 터지지 않는다', () => {
    expect(decodeCsvBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8' });
  });
});

describe('parseKeywords', () => {
  it('첫 줄(헤더)을 버린다', () => {
    expect(parseKeywords('keyword\n토익\n토플')).toEqual(['토익', '토플']);
  });

  it('BOM을 단어에 섞지 않는다', () => {
    expect(parseKeywords('﻿keyword\n토익')).toEqual(['토익']);
  });

  it('CRLF 줄바꿈을 처리한다', () => {
    expect(parseKeywords('keyword\r\n토익\r\n토플')).toEqual(['토익', '토플']);
  });

  it('빈 줄과 공백을 버린다', () => {
    expect(parseKeywords('keyword\n토익\n\n   \n토플\n')).toEqual(['토익', '토플']);
  });

  it('중복을 제거한다', () => {
    expect(parseKeywords('keyword\n토익\n토익\n토플')).toEqual(['토익', '토플']);
  });

  it('첫 칸만 단어로 쓴다', () => {
    expect(parseKeywords('keyword,비고\n토익,영어시험')).toEqual(['토익']);
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(parseKeywords('keyword\n  토익  ')).toEqual(['토익']);
  });

  it('헤더만 있으면 빈 배열', () => {
    expect(parseKeywords('keyword')).toEqual([]);
  });
});

describe('실제 default.csv', () => {
  it('UTF-8로 읽히고 단어가 들어 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const bytes = readFileSync(fileURLToPath(new URL('../default.csv', import.meta.url)));

    const { text, encoding } = decodeCsvBytes(bytes);
    expect(encoding).toBe('utf-8');

    const keywords = parseKeywords(text);
    expect(keywords.length).toBeGreaterThan(100);
    expect(keywords).toContain('토익');
    expect(keywords.every(k => k.length > 0)).toBe(true);
    expect(keywords).not.toContain('keyword'); // 헤더가 단어로 새면 안 된다
  });
});

// 회귀: Excel "유니코드 텍스트"로 저장한 CSV는 UTF-16이다. UTF-16LE의 ASCII
// 구간은 'T\0O\0E\0…'이라 UTF-8 디코더가 fatal 없이 "성공"해 버리고, NUL이
// 박힌 문자열이 그대로 단어 목록이 됐다 — UI는 "✅ 로드 완료", 결과는 탐지 0건.
describe('UTF-16 CSV (Excel "유니코드 텍스트" 저장)', () => {
  const utf16 = (str, { bom = true, little = true } = {}) => {
    const bytes = [];
    if (bom) bytes.push(...(little ? [0xff, 0xfe] : [0xfe, 0xff]));
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      bytes.push(...(little ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
    }
    return new Uint8Array(bytes);
  };

  it('BOM 있는 UTF-16LE를 읽는다', () => {
    expect(decodeCsvBytes(utf16('keyword\r\n토익'))).toEqual({
      text: 'keyword\r\n토익',
      encoding: 'utf-16le',
    });
  });

  it('BOM 있는 UTF-16BE를 읽는다', () => {
    const { text, encoding } = decodeCsvBytes(utf16('keyword\r\n토익', { little: false }));
    expect(encoding).toBe('utf-16be');
    expect(text).toBe('keyword\r\n토익');
  });

  it('BOM 없는 UTF-16LE도 UTF-8로 오인하지 않는다', () => {
    const { encoding } = decodeCsvBytes(utf16('keyword\r\nTOEIC\r\nTOEFL', { bom: false }));
    expect(encoding).toBe('utf-16le');
  });

  it('UTF-16 단어 목록에 NUL이 섞여 들어가지 않는다', () => {
    const { text } = decodeCsvBytes(utf16('keyword\r\nTOEIC\r\nTOEFL', { bom: false }));
    expect(parseKeywords(text)).toEqual(['TOEIC', 'TOEFL']);
  });

  it('CP949를 UTF-16으로 오판하지 않는다', () => {
    // 'keyword\n토익' — NUL이 없으므로 UTF-16 추정에 걸리면 안 된다.
    const bytes = new Uint8Array([
      0x6b, 0x65, 0x79, 0x77, 0x6f, 0x72, 0x64, 0x0a,
      0xc5, 0xe4, 0xc0, 0xcd,
    ]);
    expect(decodeCsvBytes(bytes).encoding).toBe('euc-kr');
  });
});

// 회귀: line.split(',')[0]은 Excel이 저장한 인용 필드를 조각냈다.
// 남은 따옴표는 escapeRegex로 리터럴 처리되어 그 단어가 영영 매칭되지 않았다.
describe('parseKeywords — RFC4180 인용 필드', () => {
  it('따옴표 안의 쉼표에 칸이 쪼개지지 않는다', () => {
    expect(parseKeywords('keyword,비고\r\n"토익, 토플",영어\r\n')).toEqual(['토익, 토플']);
  });

  it('이스케이프된 따옴표("")를 복원한다', () => {
    expect(parseKeywords('keyword\r\n"가""나"\r\n')).toEqual(['가"나']);
  });

  it('따옴표 안의 줄바꿈에 레코드가 쪼개지지 않는다', () => {
    // 두 번째 칸(비고)에 줄바꿈이 든 경우 — 단어는 2개여야 한다.
    expect(parseKeywords('keyword,비고\r\n토익,"영어\r\n시험"\r\n토플,x\r\n')).toEqual(['토익', '토플']);
  });

  it('따옴표가 남은 단어를 만들지 않는다', () => {
    expect(parseKeywords('keyword\r\n"토익"\r\n')).toEqual(['토익']);
  });
});

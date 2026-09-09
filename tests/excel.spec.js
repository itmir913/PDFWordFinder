import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildSheetResult,
  cellToText,
  dateFormatFor,
  SHEET_READ_OPTIONS,
  DETECTED_HEADER,
  FOUND_WORDS_HEADER,
} from '../src/workers/lib/excel.js';
import { buildPattern, CONSEC_SPACE_LABEL } from '../src/workers/lib/keywords.js';

const { pattern, kwMap } = buildPattern(['토익', 'TOEFL']);
const build = (rows, detectConsecutiveSpaces = false) =>
  buildSheetResult(rows, pattern, kwMap, detectConsecutiveSpaces);

describe('buildSheetResult', () => {
  it('헤더 뒤에 결과 컬럼 2개를 붙인다', () => {
    const { resultRows } = build([['이름', '내용']]);
    expect(resultRows[0]).toEqual(['이름', '내용', DETECTED_HEADER, FOUND_WORDS_HEADER]);
  });

  it('발견된 행은 TRUE와 단어 목록을 남긴다', () => {
    const { resultRows, detectedCount } = build([
      ['이름', '내용'],
      ['김', '토익 준비함'],
      ['이', '평범한 내용'],
    ]);
    expect(resultRows[1]).toEqual(['김', '토익 준비함', 'TRUE', '토익']);
    expect(resultRows[2]).toEqual(['이', '평범한 내용', 'FALSE', '']);
    expect(detectedCount).toBe(1);
  });

  it('한 행에서 찾은 단어를 모두 나열한다', () => {
    const { resultRows } = build([['내용'], ['토익과 TOEFL 성적']]);
    expect(resultRows[1][1]).toBe('TRUE');
    expect(resultRows[1][2].split(', ').sort()).toEqual(['TOEFL', '토익']);
  });

  // 재실행 시 컬럼이 계속 늘어나면 파일이 망가진다.
  it('앞선 실행이 붙인 결과 컬럼을 제거하고 다시 만든다', () => {
    const once = build([['이름', '내용'], ['김', '토익']]);
    const twice = buildSheetResult(once.resultRows, pattern, kwMap);

    expect(twice.resultRows[0]).toEqual(once.resultRows[0]);
    expect(twice.resultRows[1]).toEqual(once.resultRows[1]);
  });

  it('결과 컬럼이 가운데 있어도 제거한다', () => {
    const { resultRows } = build([
      ['이름', DETECTED_HEADER, '내용', FOUND_WORDS_HEADER],
      ['김', 'TRUE', '토익', '토익'],
    ]);
    expect(resultRows[0]).toEqual(['이름', '내용', DETECTED_HEADER, FOUND_WORDS_HEADER]);
    expect(resultRows[1]).toEqual(['김', '토익', 'TRUE', '토익']);
  });

  it('발견여부는 항상 끝에서 두 번째 컬럼이다', () => {
    const { resultRows, detectedColIndex } = build([['a', 'b', 'c']]);
    expect(detectedColIndex).toBe(resultRows[0].length - 2);
    expect(resultRows[0][detectedColIndex]).toBe(DETECTED_HEADER);
  });

  it('빈 시트도 터지지 않는다', () => {
    expect(build([]).resultRows).toEqual([[DETECTED_HEADER, FOUND_WORDS_HEADER]]);
  });

  it('행이 비어 있거나 짧아도 터지지 않는다', () => {
    const { resultRows, rowCount } = build([['이름', '내용'], [], ['김']]);
    expect(rowCount).toBe(2);
    expect(resultRows[1]).toEqual(['FALSE', '']); // 빈 행 + 결과 컬럼 2개
  });

  it('연속 공백 옵션을 켜면 라벨을 붙인다', () => {
    const { resultRows } = build([['내용'], ['가  나']], true);
    expect(resultRows[1][1]).toBe('TRUE');
    expect(resultRows[1][2]).toBe(CONSEC_SPACE_LABEL);
  });

  it('연속 공백 옵션이 꺼져 있으면 붙이지 않는다', () => {
    expect(build([['내용'], ['가  나']], false).resultRows[1][1]).toBe('FALSE');
  });
});

// 회귀: cellDates 없이 읽으면 날짜가 엑셀 시리얼 숫자로 들어와,
// 결과 파일에서 생년월일·일자 컬럼이 통째로 45356.0006 같은 숫자가 됐다.
describe('날짜 셀', () => {
  const sheetWithDate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['이름', '일자'], ['김', new Date(2024, 2, 5)]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  };

  it('SHEET_READ_OPTIONS로 읽으면 Date로 들어온다', () => {
    const wb = XLSX.read(sheetWithDate(), SHEET_READ_OPTIONS);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });
    expect(rows[1][1]).toBeInstanceOf(Date);
  });

  it('cellDates 없이 읽으면 시리얼 숫자가 된다 (이 옵션이 필요한 이유)', () => {
    const wb = XLSX.read(sheetWithDate(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: '' });
    expect(typeof rows[1][1]).toBe('number');
  });

  it('결과 행에 Date를 그대로 남긴다', () => {
    const date = new Date(2024, 2, 5);
    const { resultRows } = build([['이름', '일자'], ['김', date]]);
    expect(resultRows[1][1]).toBe(date);
  });

  it('검사에는 yyyy-mm-dd 형태를 쓴다', () => {
    expect(cellToText(new Date(2024, 2, 5))).toBe('2024-03-05');
    expect(cellToText(new Date(2024, 2, 5, 9, 7, 3))).toBe('2024-03-05 09:07:03');
    expect(cellToText('토익')).toBe('토익');
    expect(cellToText(42)).toBe(42);
  });

  it('날짜 셀에 줄 서식을 알려 준다', () => {
    expect(dateFormatFor(new Date(2024, 2, 5))).toBe('yyyy-mm-dd');
    expect(dateFormatFor(new Date(2024, 2, 5, 9, 7, 3))).toBe('yyyy-mm-dd hh:mm:ss');
    expect(dateFormatFor('토익')).toBe(null);
    expect(dateFormatFor(45356)).toBe(null);
  });
});

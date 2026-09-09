// Excel 시트 변환 로직 (순수 함수 — Worker 밖에서도 테스트 가능)
import { findKeywordsInRow } from './keywords.js';

// SheetJS 읽기 옵션. cellDates가 빠지면 날짜 셀이 엑셀 시리얼 숫자로 들어와
// 결과 파일의 모든 날짜가 45356.0006 같은 숫자로 바뀐다.
export const SHEET_READ_OPTIONS = { type: 'array', cellDates: true };

export const DETECTED_HEADER = '발견여부';
export const FOUND_WORDS_HEADER = '발견된 단어';

// 셀 값을 검사용 문자열로 바꾼다.
//
// SheetJS를 cellDates로 읽으면 날짜 셀이 Date 객체로 온다. String(Date)는
// 'Tue Mar 05 2024 …' 같은 영문 표기라 검사 대상으로 부적절하다.
export function cellToText(cell) {
  if (!(cell instanceof Date)) return cell;
  const pad = n => String(n).padStart(2, '0');
  const date = `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
  if (cell.getHours() === 0 && cell.getMinutes() === 0 && cell.getSeconds() === 0) return date;
  return `${date} ${pad(cell.getHours())}:${pad(cell.getMinutes())}:${pad(cell.getSeconds())}`;
}

// 날짜 셀에 서식을 주지 않으면 Excel이 시리얼 숫자(45356.0006)를 그대로 보여 준다.
export function dateFormatFor(cell) {
  if (!(cell instanceof Date)) return null;
  const midnight = cell.getHours() === 0 && cell.getMinutes() === 0 && cell.getSeconds() === 0;
  return midnight ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm:ss';
}

// 시트 한 장(rows: 배열의 배열) → 결과 행 + 통계
//
// 재실행 대비: 앞선 실행이 붙인 결과 컬럼은 제거한 뒤 다시 만든다.
// 그러지 않으면 실행할 때마다 컬럼이 늘어난다.
export function buildSheetResult(rows, pattern, kwMap, detectConsecutiveSpaces = false) {
  const rawHeader = rows[0] ?? [];

  const removeIndices = new Set(
    rawHeader
      .map((h, i) => (h === DETECTED_HEADER || h === FOUND_WORDS_HEADER ? i : -1))
      .filter(i => i >= 0)
  );
  const keep = (_, i) => !removeIndices.has(i);

  const outputHeader = [...rawHeader.filter(keep), DETECTED_HEADER, FOUND_WORDS_HEADER];
  const resultRows = [outputHeader];
  let detectedCount = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = (rows[r] ?? []).filter(keep);
    const found = findKeywordsInRow(row.map(cellToText), pattern, kwMap, detectConsecutiveSpaces);
    const detected = found.length > 0;
    if (detected) detectedCount++;
    // 원본 셀 값을 그대로 남긴다 — Date를 문자열로 바꾸면 서식이 깨진다.
    resultRows.push([...row, detected ? 'TRUE' : 'FALSE', found.join(', ')]);
  }

  return {
    resultRows,
    detectedCount,
    rowCount: resultRows.length - 1,
    // 결과 컬럼 2개를 뒤에 붙였으므로 '발견여부'는 항상 끝에서 두 번째다.
    detectedColIndex: outputHeader.length - 2,
  };
}

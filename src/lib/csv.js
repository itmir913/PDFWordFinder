// 검색 단어 CSV 읽기 (순수 함수 — 스토어 밖에서도 테스트 가능)

const NUL = String.fromCharCode(0);
const REPLACEMENT = String.fromCharCode(0xfffd);
const BOM = String.fromCharCode(0xfeff);

// Excel이 붙이는 BOM은 TextDecoder가 떼 주지만, 이미 문자열로 받은 경우를 위해.
function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

// 한국 윈도우의 Excel은 CSV를 CP949(EUC-KR)로 저장한다. UTF-8로만 읽으면
// 단어가 통째로 깨진 채 "로드 완료"가 뜨고 아무것도 안 잡힌다.
//
// fatal:true가 핵심이다. 이게 없으면 TextDecoder가 깨진 바이트를 U+FFFD로
// 조용히 바꿔치기해서 폴백이 영원히 안 걸린다.
const FALLBACK_ENCODINGS = ['utf-8', 'euc-kr'];

// Excel "유니코드 텍스트"로 저장하면 UTF-16이 나온다. 문제는 UTF-16LE의
// ASCII 구간이 'T\0O\0E\0…' 이라 UTF-8로도 fatal 없이 "성공"한다는 것 —
// NUL 범벅인 문자열이 단어 목록으로 들어가 탐지 0건이 된다. 그래서 UTF-16을
// 폴백 뒤가 아니라 앞에서 걸러 낸다.
function encodingFromBom(data) {
  if (data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe) return 'utf-16le';
    if (data[0] === 0xfe && data[1] === 0xff) return 'utf-16be';
  }
  return null;
}

// BOM이 없는 UTF-16 추정: UTF-8에도 CP949에도 NUL 바이트는 나올 수 없다.
// 한쪽 정렬 위치에만 NUL이 몰려 있으면 그 방향의 UTF-16으로 본다.
function guessUtf16(data) {
  const sample = data.subarray(0, 512);
  if (sample.length < 4) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 0) evenNul++;
    else oddNul++;
  }
  if (evenNul + oddNul < sample.length / 8) return null;
  return oddNul >= evenNul ? 'utf-16le' : 'utf-16be';
}

// 디코딩이 "성공"해도 결과가 쓸 수 없는 경우가 있다(위의 UTF-16 사례).
// NUL과 대체문자가 없어야 실제로 읽힌 것으로 본다.
function isUsableText(text) {
  return !text.includes(NUL) && !text.includes(REPLACEMENT);
}

export function decodeCsvBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const utf16 = encodingFromBom(data) ?? guessUtf16(data);
  const candidates = utf16 ? [utf16, ...FALLBACK_ENCODINGS] : [...FALLBACK_ENCODINGS];

  for (const encoding of candidates) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(data);
      if (isUsableText(text)) return { text, encoding };
      // 디코딩은 됐지만 NUL/대체문자가 남았다 — 다음 후보로 넘어간다.
    } catch {
      // 의도적 무시: 이 인코딩으로는 못 읽는다는 뜻이다. 후보를 다 소진하면
      // encoding: unknown으로 알리므로 여기서 삼켜도 조용히 넘어가지 않는다.
    }
  }

  // 어느 쪽으로도 못 읽으면 UTF-8로 최대한 복구해서라도 넘긴다.
  // 호출자는 encoding === 'unknown'을 로드 실패로 다뤄야 한다 — 깨진 단어
  // 목록으로 검사를 돌리면 오류 없이 "탐지 0건"이 나온다.
  return { text: new TextDecoder('utf-8').decode(data), encoding: 'unknown' };
}

// 각 레코드의 첫 칸만 뽑는다. RFC4180 인용 필드를 존중하므로 따옴표 안의
// 쉼표·줄바꿈에 레코드가 쪼개지지 않는다.
//
// 단순 split(',')이던 시절에는 Excel이 저장한 `"토익, 토플",비고` 가
// `"토익` 으로 들어가, 남은 따옴표 때문에 그 단어가 영영 매칭되지 않았다.
function firstFieldPerRecord(text) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  let fieldDone = false;    // 이 레코드의 첫 칸이 이미 끝났는가
  let atFieldStart = true;  // 인용은 칸 맨 앞에서만 시작된다

  // 인용 상태는 뒤쪽 칸에서도 추적해야 한다. 비고 칸에 든 줄바꿈으로
  // 레코드가 쪼개지면 그 조각이 단어로 새어 들어간다.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch !== '"') {
        if (!fieldDone) field += ch;
      } else if (text[i + 1] === '"') {
        if (!fieldDone) field += '"'; // 이스케이프된 따옴표
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === ',') {
      fieldDone = true;
      atFieldStart = true;
    } else if (ch === '\n') {
      fields.push(field);
      field = '';
      fieldDone = false;
      atFieldStart = true;
    } else if (ch !== '\r') {
      if (!fieldDone) field += ch;
      atFieldStart = false;
    }
  }
  fields.push(field);

  return fields;
}

// 첫 줄(헤더)을 버리고 각 레코드의 첫 칸을 단어로 쓴다. 중복·빈 줄은 제거.
export function parseKeywords(text) {
  const records = firstFieldPerRecord(stripBom(text)).slice(1);
  return [...new Set(records.map(field => field.trim()).filter(Boolean))];
}

// 파일 경로 계산 (순수 함수 — 스토어 밖에서도 테스트 가능)
//
// 윈도우 역슬래시와 POSIX 슬래시가 섞여 들어온다. Tauri의 드래그앤드롭은
// OS 경로를 그대로 주고, dialog도 마찬가지다.

export function fileNameOf(path) {
  return String(path).replace(/\\/g, '/').split('/').pop();
}

export function extensionOf(path) {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// 원본과 같은 폴더에 output_ 접두사를 붙인 경로.
//
// replace()로 만들면 안 된다. 치환 문자열의 $&·$1 같은 시퀀스가 해석되어,
// 파일명에 '$&'가 들어 있으면 경로가 조용히 깨진다.
export function outputPathFor(path) {
  const name = fileNameOf(path);
  return String(path).slice(0, String(path).length - name.length) + `output_${name}`;
}

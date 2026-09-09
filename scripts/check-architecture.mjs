// CLAUDE.md의 아키텍처 규칙을 기계로 강제한다.
//
// 셔뱅(#!)을 두지 않는다. package.json은 `node scripts/...`로 부르므로 필요 없고,
// tests/check-architecture.spec.js가 이 파일을 import할 때 Vite의 트랜스폼이
// 셔뱅 + CRLF 조합을 SyntaxError로 만든다 — 윈도우 체크아웃에서만 터진다.
// 사람이 리뷰에서 놓치기 쉬운 것만 골랐다 — 규칙을 늘릴 거면 여기에 더한다.
//
// 파일을 통째로 읽어 검사한다. 예전에는 줄 단위로 훑어서, 여러 줄에 걸친
// 위반(속성이 줄바꿈된 태그, 두 줄짜리 빈 catch)을 전부 놓쳤다.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 확장자를 하나 추가하는 것만으로 규칙이 통째로 비껴가지 않게 넓게 잡는다.
const CODE = ['.vue', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];

// 삼켜도 되는 catch에 붙이는 표식. 왜 삼켜도 되는지 옆에 쓴다.
const SILENT_CATCH_PRAGMA = '의도적 무시:';

// fs.globSync는 Node 22에서 아직 실험적이라 쓰지 않는다.
function filesUnder(dir, extensions) {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && extensions.some(ext => e.name.endsWith(ext)))
    .map(e => `${join(e.parentPath, e.name).slice(ROOT.length)}`.replaceAll('\\', '/'));
}

// 정규식 여러 개를 파일 전체에 돌려 { index } 목록으로 만든다.
const matcher = (...patterns) => (content) =>
  patterns.flatMap(pattern => [...content.matchAll(pattern)].map(m => ({ index: m.index })));

// 주석·세미콜론·공백만 남는 catch 본문은 에러를 삼키는 것이다.
function silentCatches(content) {
  const hits = [];
  const CATCH = /catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/g;
  for (const match of content.matchAll(CATCH)) {
    const body = match[1];
    if (body.includes(SILENT_CATCH_PRAGMA)) continue;
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/[\s;]/g, '');
    if (stripped === '') hits.push({ index: match.index });
  }
  return hits;
}

// <style> 블록 안의 하드코딩된 색·치수. @apply 줄은 허용한다.
function hardcodedStyleValues(content) {
  const hits = [];
  for (const block of content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const body = block[1];
    const bodyStart = block.index + block[0].indexOf(body);
    for (const line of body.matchAll(/[^\n]+/g)) {
      if (line[0].includes('@apply')) continue;
      if (/#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em)\b|\brgba?\(/.test(line[0])) {
        hits.push({ index: bodyStart + line.index });
      }
    }
  }
  return hits;
}

const RULES = [
  {
    // 규칙 이름을 'invoke'로 잡으면 별칭 import(`invoke as ipc`), 네임스페이스
    // 호출(`core.invoke`), 전역(`window.__TAURI__`), invoke가 아닌 IPC
    // (`getCurrentWindow().onDragDropEvent`)가 전부 샌다. import를 막는다.
    name: 'Tauri IPC는 스토어에서만 부른다',
    why: 'Tauri IPC를 한 곳에 모아 두어야 권한·에러 처리를 한 번만 손본다.',
    dir: 'src',
    extensions: CODE,
    skip: ['src/stores/app.js'],
    find: matcher(
      /from\s*['"]@tauri-apps\/[^'"]*['"]/g,
      /require\s*\(\s*['"]@tauri-apps\/[^'"]*['"]\s*\)/g,
      /import\s*\(\s*['"]@tauri-apps\/[^'"]*['"]\s*\)/g,
      /window\s*\.\s*__TAURI__|globalThis\s*\.\s*__TAURI__/g,
      /(^|[^.\w])invoke\s*\(/g,
    ),
  },
  {
    name: '인라인 style 속성 금지',
    why: 'Tailwind 유틸리티 클래스로만 스타일링한다.',
    dir: 'src',
    extensions: ['.vue'],
    // `:style="..."` / `v-bind:style="..."` 바인딩도 막는다 — 인라인 스타일을
    // 넣는 가장 자연스러운 경로가 그쪽이다.
    find: matcher(/(?:^|[\s:])style\s*=\s*["']/g),
  },
  {
    name: '<style> 블록에 하드코딩된 색·치수 금지',
    why: '색·치수는 main.css의 @theme 토큰으로 정의한다 (@apply는 허용).',
    dir: 'src',
    extensions: ['.vue'],
    find: hardcodedStyleValues,
  },
  {
    name: 'Vue 컴포넌트에 비즈니스 로직 금지',
    why: '분류·계산·네트워크는 스토어와 lib으로 올린다. 컴포넌트는 화면만 그린다.',
    dir: 'src',
    extensions: ['.vue'],
    find: matcher(
      /\bfetch\s*\(/g,
      /\bnew\s+URL\s*\(/g,
      /\/(?:\\.|\[[^\]]*\]|[^/\n\\])+\/[gimsuy]*\s*\.\s*(?:test|exec)\s*\(/g,
    ),
  },
  {
    name: '워커를 스토어 밖에서 만들지 않는다',
    why: '워커 수명 관리는 스토어 책임이다.',
    dir: 'src',
    extensions: CODE,
    skip: ['src/stores/app.js'],
    find: matcher(/new\s+Worker\s*\(/g),
  },
  {
    // 이건 스타일 문제가 아니다. 정규식 리터럴의 lookbehind는 파싱 시점
    // SyntaxError라, 지원하지 않는 엔진에서는 그 모듈이 통째로 로드에 실패한다.
    name: '정규식 lookbehind 금지 (?<= / ?<!)',
    why: 'Safari 16.4(macOS 13.3) 미만 WKWebView에서 모듈 전체가 SyntaxError로 죽는다.',
    dir: 'src',
    extensions: CODE,
    find: matcher(/\(\?<[=!]/g),
  },
  {
    name: '삼켜지는 에러 금지 (빈 catch)',
    why: `CLAUDE.md — Silent error handling 금지. 정말 무시해야 하면 본문에 '${SILENT_CATCH_PRAGMA} 이유'를 남긴다.`,
    dir: 'src',
    extensions: CODE,
    find: (content) => [
      ...silentCatches(content),
      ...matcher(/\.catch\s*\(\s*(?:\([^)]*\)|[\w$]+)\s*=>\s*\{\s*\}\s*\)/g)(content),
    ],
  },
];

const lineOf = (content, index) => content.slice(0, index).split('\n').length;
const lineTextOf = (content, index) => {
  const start = content.lastIndexOf('\n', index) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end === -1 ? undefined : end).trim();
};

// 규칙 자체를 테스트에서 검증할 수 있게 내보낸다 —
// 검사기가 조용히 약해지는 것이 이 프로젝트에서 실제로 있었던 일이다.
export { RULES };

function main() {
  let failed = 0;

  for (const rule of RULES) {
    const files = filesUnder(rule.dir, rule.extensions)
      .filter(f => !(rule.skip ?? []).includes(f));

    // 경로가 바뀌어 규칙이 조용히 무력화되는 것을 막는다.
    if (files.length === 0) {
      console.error(`✖ 규칙 "${rule.name}"이 검사할 파일을 하나도 못 찾았다 (${rule.dir}).`);
      failed++;
      continue;
    }

    for (const file of files) {
      const content = readFileSync(join(ROOT, file), 'utf8');
      for (const { index } of rule.find(content)) {
        console.error(`✖ ${file}:${lineOf(content, index)}  ${rule.name}`);
        console.error(`    ${lineTextOf(content, index)}`);
        console.error(`    ↳ ${rule.why}`);
        failed++;
      }
    }
  }

  if (failed > 0) {
    console.error(`\n아키텍처 규칙 위반 ${failed}건.`);
    process.exit(1);
  }
  console.log(`✔ 아키텍처 규칙 ${RULES.length}개 통과 (검사 파일 ${filesUnder('src', CODE).length}개)`);
}

// import해서 규칙만 가져다 쓸 때는 검사를 돌리지 않는다.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

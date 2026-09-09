// 검사기가 조용히 약해지는 것은 이 프로젝트에서 실제로 있었던 일이다.
// 규칙이 "무엇을 잡아야 하는가"를 여기에 고정해 둔다.
import { describe, it, expect } from 'vitest';
import { RULES } from '../scripts/check-architecture.mjs';

const rule = name => {
  const found = RULES.find(r => r.name === name);
  if (!found) throw new Error(`규칙을 찾을 수 없다: ${name}`);
  return found;
};
const hits = (name, content) => rule(name).find(content).length;

const IPC = 'Tauri IPC는 스토어에서만 부른다';
const STYLE = '인라인 style 속성 금지';
const STYLE_BLOCK = '<style> 블록에 하드코딩된 색·치수 금지';
const LOGIC = 'Vue 컴포넌트에 비즈니스 로직 금지';
const WORKER = '워커를 스토어 밖에서 만들지 않는다';
const CATCH = '삼켜지는 에러 금지 (빈 catch)';

describe('Tauri IPC 규칙', () => {
  it.each([
    ['그냥 호출', "import { invoke } from '@tauri-apps/api/core';\ninvoke('read_file_bytes');"],
    ['별칭 import', "import { invoke as ipc } from '@tauri-apps/api/core';\nipc('x');"],
    ['네임스페이스 호출', "import * as core from '@tauri-apps/api/core';\ncore.invoke('x');"],
    ['전역 __TAURI__', "window.__TAURI__.core.invoke('x');"],
    ['동적 import', "const core = await import('@tauri-apps/api/core');"],
    ['호출 앞 줄바꿈', "await invoke\n('x');"],
    // invoke가 아닌 IPC도 IPC다 — 이걸 놓쳐서 App.vue 위반이 통과하고 있었다.
    ['invoke가 아닌 IPC', "import { getCurrentWindow } from '@tauri-apps/api/window';\ngetCurrentWindow().onDragDropEvent(() => {});"],
    ['플러그인 import', "import { open } from '@tauri-apps/plugin-dialog';"],
  ])('%s를 잡는다', (_, code) => {
    expect(hits(IPC, code)).toBeGreaterThan(0);
  });

  it('평범한 코드는 잡지 않는다', () => {
    expect(hits(IPC, "import { useAppStore } from '../stores/app.js';\nstore.selectFiles();")).toBe(0);
  });

  it('스토어만 예외로 둔다', () => {
    expect(rule(IPC).skip).toEqual(['src/stores/app.js']);
  });
});

describe('스타일 규칙', () => {
  it.each([
    ['인라인 style 속성', '<div style="color:red">x</div>'],
    [':style 바인딩', '<div :style="{ color: c }">x</div>'],
    ['v-bind:style', '<div v-bind:style="s">x</div>'],
    ['속성이 여러 줄', '<div\n  class="a"\n  style="color:red"\n>x</div>'],
  ])('%s를 잡는다', (_, code) => {
    expect(hits(STYLE, code)).toBeGreaterThan(0);
  });

  it('class는 잡지 않는다', () => {
    expect(hits(STYLE, '<div class="text-base bg-app-bg">x</div>')).toBe(0);
  });

  it('<style> 블록의 하드코딩된 값을 잡는다', () => {
    expect(hits(STYLE_BLOCK, '<style scoped>\n.box { color: #ff0000; }\n</style>')).toBeGreaterThan(0);
    expect(hits(STYLE_BLOCK, '<style scoped>\n.box { padding: 13px; }\n</style>')).toBeGreaterThan(0);
  });

  it('@apply는 허용한다', () => {
    expect(hits(STYLE_BLOCK, '<style scoped>\n.box { @apply px-3 py-2 text-app-muted; }\n</style>')).toBe(0);
  });
});

describe('컴포넌트 비즈니스 로직 규칙', () => {
  it.each([
    ['fetch', "const res = await fetch('https://api.github.com/x');"],
    ['new URL', "const u = new URL('./w.js', import.meta.url);"],
    ['정규식 분류', 'const pdfs = paths.filter(p => /\\.(pdf|xlsx)$/i.test(p));'],
  ])('%s를 잡는다', (_, code) => {
    expect(hits(LOGIC, code)).toBeGreaterThan(0);
  });

  it('스토어 액션 호출은 잡지 않는다', () => {
    expect(hits(LOGIC, 'store.handleDroppedPaths(paths);\nstore.addFiles(files);')).toBe(0);
  });

  it('컴포넌트에서 만드는 워커를 잡는다', () => {
    expect(hits(WORKER, "const w = new Worker(new URL('./p.js', import.meta.url));")).toBeGreaterThan(0);
    expect(hits(WORKER, 'const w = new\n  Worker(url);')).toBeGreaterThan(0);
  });
});

describe('빈 catch 규칙', () => {
  it.each([
    ['한 줄', 'try { risky(); } catch (e) {}'],
    ['여러 줄', 'try {\n  risky();\n} catch (e) {\n}'],
    ['주석만', 'try {\n  risky();\n} catch (e) {\n  // 무시\n}'],
    ['블록 주석만', 'try {\n  risky();\n} catch (e) {\n  /* 무시 */\n}'],
    ['세미콜론만', 'try { risky(); } catch (e) { ; }'],
    ['바인딩 없는 catch', 'try {\n  risky();\n} catch {\n}'],
    ['Promise .catch', 'risky().catch(() => {});'],
    ['Promise .catch(e => {})', 'risky().catch(e => {});'],
  ])('%s 빈 catch를 잡는다', (_, code) => {
    expect(hits(CATCH, code)).toBeGreaterThan(0);
  });

  it('로그를 남기는 catch는 잡지 않는다', () => {
    expect(hits(CATCH, 'try {\n  risky();\n} catch (e) {\n  this.addLog(`❌ ${e}`);\n}')).toBe(0);
  });

  it('의도적 무시 표식이 있으면 통과시킨다', () => {
    expect(hits(CATCH, 'try {\n  risky();\n} catch {\n  // 의도적 무시: 다음 후보로 넘어간다.\n}')).toBe(0);
  });
});

describe('검사 범위', () => {
  it('확장자를 추가하는 것만으로 규칙을 비껴갈 수 없다', () => {
    for (const name of [IPC, WORKER, CATCH]) {
      expect(rule(name).extensions).toEqual(
        expect.arrayContaining(['.vue', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']),
      );
    }
  });

  it('워커 규칙이 src 전체를 본다 (예전에는 src/components뿐이라 App.vue가 빠졌다)', () => {
    expect(rule(WORKER).dir).toBe('src');
  });
});

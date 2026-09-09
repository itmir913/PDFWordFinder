// 스토어 282줄에 테스트가 하나도 없었다. Worker와 Tauri IPC만 대역으로
// 세우면 나머지 로직(분류·중복 제거·인코딩 분기·상태 전이)은 전부 검증할 수 있다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const invoke = vi.fn();
const open = vi.fn();
const openUrl = vi.fn();
const getVersion = vi.fn(async () => '2026.8.19');
const onDragDropEvent = vi.fn(async () => () => {});

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a) => invoke(...a) }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: (...a) => getVersion(...a) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a) => open(...a) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a) => openUrl(...a) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onDragDropEvent: (...a) => onDragDropEvent(...a) }),
}));

const { useAppStore } = await import('../src/stores/app.js');

const utf8 = str => [...new TextEncoder().encode(str)];
let store;

beforeEach(() => {
  setActivePinia(createPinia());
  store = useAppStore();
  vi.clearAllMocks();
});

const lastLog = () => store.logs[store.logs.length - 1];
const logs = () => store.logs.join('\n');

describe('addFiles', () => {
  it('PDF와 XLSX만 목록에 넣는다', () => {
    store.addFiles(['C:\\a\\1.pdf', 'C:\\a\\2.xlsx']);
    expect(store.files.map(f => f.name)).toEqual(['1.pdf', '2.xlsx']);
  });

  // 조용히 버리면 사용자는 앱이 고장 난 줄 안다.
  it('지원하지 않는 형식을 알린다', () => {
    store.addFiles(['C:\\a\\보고서.hwp', 'C:\\a\\명렬표.xls']);
    expect(store.files).toHaveLength(0);
    expect(logs()).toContain('지원하지 않는 형식 2개');
  });

  it('이미 목록에 있는 파일을 알린다', () => {
    store.addFiles(['C:\\a\\1.pdf']);
    store.addFiles(['C:\\a\\1.pdf']);
    expect(store.files).toHaveLength(1);
    expect(logs()).toContain('이미 목록에 있는 1개');
  });

  // 회귀: 중복 검사 Set을 루프 안에서 갱신하지 않아, 한 번의 호출에 같은
  // 경로가 두 번 들어오면 중복 항목 둘이 같은 output_ 경로를 두고 다퉜다.
  it('한 번의 호출에 들어온 중복도 걸러낸다', () => {
    store.addFiles(['C:\\a\\1.pdf', 'C:\\a\\1.pdf']);
    expect(store.files).toHaveLength(1);
  });

  it('id는 항목마다 다르다', () => {
    store.addFiles(['C:\\a\\1.pdf', 'C:\\a\\2.pdf']);
    expect(store.files[0].id).not.toBe(store.files[1].id);
  });
});

describe('handleDroppedPaths', () => {
  it('CSV와 검사 대상을 갈라 처리한다', async () => {
    invoke.mockResolvedValue(utf8('keyword\n토익'));
    await store.handleDroppedPaths(['C:\\a\\words.csv', 'C:\\a\\1.pdf']);

    expect(store.keywords).toEqual(['토익']);
    expect(store.files.map(f => f.name)).toEqual(['1.pdf']);
    expect(store.activeTab).toBe(1);
  });

  it('CSV가 둘 이상이면 등록하지 않고 알린다', async () => {
    await store.handleDroppedPaths(['C:\\a\\1.csv', 'C:\\a\\2.csv']);
    expect(invoke).not.toHaveBeenCalled();
    expect(logs()).toContain('한 번에 하나만');
  });

  // 회귀: 버튼만 잠기고 드롭은 열려 있어, 실행 중 추가한 파일이 이번 실행에
  // 끌려 들어가거나 파일마다 다른 단어 목록이 적용됐다.
  it('처리 중에는 아무것도 추가하지 않는다', async () => {
    store.isProcessing = true;
    await store.handleDroppedPaths(['C:\\a\\1.pdf', 'C:\\a\\words.csv']);

    expect(store.files).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(logs()).toContain('처리 중에는');
  });

  it('CSV 읽기 실패를 로그로 알리고 예외를 밖으로 던지지 않는다', async () => {
    invoke.mockRejectedValue('파일이 사용 중입니다');
    await expect(store.handleDroppedPaths(['C:\\a\\words.csv'])).resolves.toBeUndefined();
    expect(logs()).toContain('CSV 로드 실패');
  });
});

describe('CSV 로드', () => {
  it('CP949 CSV를 읽고 인코딩을 알린다', async () => {
    // 'keyword\n토익' — 한글 부분이 CP949
    invoke.mockResolvedValue([0x6b, 0x65, 0x79, 0x77, 0x6f, 0x72, 0x64, 0x0a, 0xc5, 0xe4, 0xc0, 0xcd]);
    await store.loadCsvFromPath('C:\\a\\words.csv');

    expect(store.keywords).toEqual(['토익']);
    expect(logs()).toContain('euc-kr');
  });

  // 회귀: 판별 실패를 성공으로 넘기면 깨진 목록으로 검사가 돌아 탐지 0건이 된다.
  it('인코딩을 판별하지 못하면 목록을 바꾸지 않고 ❌로 알린다', async () => {
    store.keywords = ['기존단어'];
    invoke.mockResolvedValue([0xff, 0xff]);
    await store.loadCsvFromPath('C:\\a\\words.csv');

    expect(store.keywords).toEqual(['기존단어']);
    expect(lastLog()).toContain('❌');
    expect(lastLog()).toContain('인코딩');
  });

  it('단어가 하나도 없으면 목록을 바꾸지 않고 ❌로 알린다', async () => {
    store.keywords = ['기존단어'];
    invoke.mockResolvedValue(utf8('keyword\n\n   \n'));
    await store.loadCsvFromPath('C:\\a\\words.csv');

    expect(store.keywords).toEqual(['기존단어']);
    expect(lastLog()).toContain('❌');
  });

  it('default.csv를 못 읽었다는 경고를 그대로 보여 준다', async () => {
    invoke.mockResolvedValue({
      content: utf8('keyword\n토익'),
      source: 'embedded',
      warning: 'C:/app/default.csv 을(를) 읽지 못했습니다: 액세스 거부',
    });
    await store.loadDefaultCsv();

    expect(logs()).toContain('액세스 거부');
    expect(logs()).toContain('내장 단어 목록');
  });

  it('경고가 없으면 경고를 찍지 않는다', async () => {
    invoke.mockResolvedValue({ content: utf8('keyword\n토익'), source: 'default_file', warning: null });
    await store.loadDefaultCsv();
    expect(logs()).not.toContain('⚠️');
  });
});

describe('처리 상태', () => {
  it('단어나 파일이 없으면 시작하지 않는다', async () => {
    await store.startProcessing();
    expect(store.isProcessing).toBe(false);
  });

  it('중지하면 남은 파일을 중단으로 표시하고 잠금을 푼다', () => {
    store.addFiles(['C:\\a\\1.pdf', 'C:\\a\\2.pdf']);
    store.isProcessing = true;
    store.files[0].status = '처리중';

    store.stopProcessing();

    expect(store.files.map(f => f.status)).toEqual(['중단', '중단']);
    expect(store.isProcessing).toBe(false);
    expect(logs()).toContain('중단');
  });

  it('처리 중이 아니면 중지는 아무것도 하지 않는다', () => {
    store.stopProcessing();
    expect(store.logs).toHaveLength(0);
  });

  it('성공한 파일은 중단으로 바꾸지 않는다', () => {
    store.addFiles(['C:\\a\\1.pdf']);
    store.files[0].status = '성공';
    store.isProcessing = true;

    store.stopProcessing();

    expect(store.files[0].status).toBe('성공');
  });
});

describe('최신버전 확인', () => {
  it('실패를 로그로 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await store.fetchLatestVersion();

    expect(store.latestVersion).toBe('');
    expect(logs()).toContain('최신버전 확인 실패');
    vi.unstubAllGlobals();
  });

  it('rate limit(403)을 성공으로 넘기지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    await store.fetchLatestVersion();

    expect(store.latestVersion).toBe('');
    expect(logs()).toContain('403');
    vi.unstubAllGlobals();
  });

  // 탭을 오갈 때마다 부르면 시간당 60회 제한에 걸린다.
  it('이미 조회했으면 다시 부르지 않는다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: '2026.8.19', html_url: 'u' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await store.fetchLatestVersion();
    await store.fetchLatestVersion();
    await store.fetchLatestVersion();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.latestVersion).toBe('2026.8.19');
    vi.unstubAllGlobals();
  });
});

describe('로그', () => {
  it('상한을 넘으면 오래된 것부터 버린다', () => {
    for (let i = 0; i < 5200; i++) store.addLog(`줄 ${i}`);
    expect(store.logs.length).toBeLessThanOrEqual(5000);
    expect(lastLog()).toContain('줄 5199');
  });
});

describe('init', () => {
  it('드래그앤드롭을 등록한다', async () => {
    invoke.mockResolvedValue({ content: utf8('keyword\n토익'), source: 'embedded', warning: null });
    await store.init();

    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(store.version).toBe('2026.8.19');
  });

  it('드래그앤드롭 등록 실패를 알린다', async () => {
    invoke.mockResolvedValue({ content: utf8('keyword\n토익'), source: 'embedded', warning: null });
    onDragDropEvent.mockRejectedValueOnce(new Error('no window'));
    await store.init();

    expect(logs()).toContain('드래그앤드롭');
  });
});

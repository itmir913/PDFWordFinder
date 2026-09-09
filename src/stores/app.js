import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { decodeCsvBytes, parseKeywords } from '../lib/csv.js';
import { fileNameOf, extensionOf, outputPathFor } from '../lib/paths.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

const LOG_LIMIT = 5000;
const RELEASES_API = 'https://api.github.com/repos/itmir913/WordFinderApp/releases/latest';

export const useAppStore = defineStore('app', {
  state: () => ({
    version: '',

    // CSV / 키워드
    csvPath: '',
    keywords: [],

    // 파일 목록
    files: [], // { id, name, path, status: '대기'|'처리중'|'성공'|'실패'|'중단' }
    nextId: 1,

    // 로그
    logs: [],

    // 처리 상태
    isProcessing: false,
    stopRequested: false,

    // 활성 탭
    activeTab: 0,

    // Web Worker
    _worker: null,

    // 최신버전 (null: 미조회, '': 조회 실패)
    latestVersion: null,
    latestReleaseUrl: '',

    // 연속 공백 검사 옵션
    detectConsecutiveSpaces: true,

    // CSV 출처: 'user' | 'default_file' | 'embedded' | ''
    csvSource: '',
  }),

  getters: {
    keywordCount: (state) => state.keywords.length,
    fileCount: (state) => state.files.length,
  },

  actions: {
    // ── 앱 초기화 ─────────────────────────────────────
    async init() {
      try {
        this.version = await getVersion();
      } catch (e) {
        this.addLog(`❌ 버전 정보 로드 실패: ${e}`);
      }
      await this.loadDefaultCsv();
      await this._registerDragDrop();
    },

    // Tauri IPC는 전부 스토어에 모아 둔다 — 컴포넌트에서 직접 부르지 않는다.
    async _registerDragDrop() {
      try {
        await getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === 'drop') this.handleDroppedPaths(event.payload.paths ?? []);
        });
      } catch (e) {
        this.addLog(`❌ 드래그앤드롭을 등록하지 못했습니다: ${e}`);
      }
    },

    // 드롭된 경로를 CSV와 검사 대상으로 갈라 처리한다.
    // 분류 규칙은 도메인 지식이므로 컴포넌트가 아니라 여기 있어야 한다.
    async handleDroppedPaths(paths) {
      if (this.isProcessing) {
        this.addLog('⚠️ 처리 중에는 파일을 추가할 수 없습니다. 먼저 중지하세요.');
        return;
      }

      const csvPaths = paths.filter(path => extensionOf(path) === 'csv');
      const targets = paths.filter(path => extensionOf(path) !== 'csv');

      if (csvPaths.length > 1) {
        this.addLog('⚠️ CSV 파일은 한 번에 하나만 등록 가능합니다.');
      } else if (csvPaths.length === 1) {
        await this.loadCsvFromPath(csvPaths[0]);
      }

      if (targets.length > 0) {
        this.addFiles(targets);
        this.activeTab = 1; // 파일 탭
      }
    },

    // ── CSV ──────────────────────────────────────────
    async loadCsvFromPath(path) {
      try {
        const content = await invoke('read_file_bytes', { path });
        this._parseCsvBytes(content, path, 'user');
      } catch (e) {
        // 여기서 다시 던지면 호출부마다 catch를 달아야 한다. 로그로 알리는
        // 것이 이 앱의 오류 처리 방식이므로 여기서 끝낸다.
        this.addLog(`❌ CSV 로드 실패: ${e}`);
      }
    },

    async selectCsv() {
      try {
        const path = await open({
          filters: [{ name: 'CSV 파일', extensions: ['csv'] }],
          multiple: false,
        });
        if (path) await this.loadCsvFromPath(path);
      } catch (e) {
        this.addLog(`❌ 파일 선택 실패: ${e}`);
      }
    },

    async loadDefaultCsv() {
      try {
        const { content, source, warning } = await invoke('load_default_csv');
        // default.csv가 있는데 못 읽은 경우(Excel이 잠금, 권한 거부 등)를
        // 알린다. 예전에는 '없음'과 구별되지 않아, 편집한 단어 목록 대신
        // 내장 목록으로 조용히 검사가 돌았다.
        if (warning) this.addLog(`⚠️ ${warning}`);
        const label = source === 'embedded' ? '(내장 단어 목록)' : '(기본값: default.csv)';
        this._parseCsvBytes(content, label, source);
      } catch (e) {
        this.addLog(`❌ 기본 CSV 로드 실패: ${e}`);
      }
    },

    // 디코딩 경로는 여기 하나뿐이다 — 사용자가 고른 CSV든 default.csv든
    // 같은 인코딩 폴백을 탄다.
    _parseCsvBytes(bytes, path, source) {
      const { text, encoding } = decodeCsvBytes(bytes);
      // 판별 실패를 성공으로 넘기면 깨진 단어 목록으로 검사가 돌아
      // 오류 없이 "탐지 0건"이 된다 — CP949 사고와 같은 실패 모드다.
      if (encoding === 'unknown') {
        this.addLog(`❌ CSV 인코딩을 판별하지 못했습니다. UTF-8 또는 CP949(ANSI)로 저장한 뒤 다시 시도하세요. | ${path}`);
        return;
      }
      if (encoding !== 'utf-8') {
        this.addLog(`ℹ️ CSV 인코딩을 ${encoding}(으)로 읽었습니다.`);
      }
      this._parseCsvText(text, path, source);
    },

    _parseCsvText(text, path, source) {
      const kws = parseKeywords(text);
      if (kws.length === 0) {
        this.addLog(`❌ 검색 단어를 하나도 읽지 못했습니다. 첫 줄은 제목 행으로 건너뛰므로 두 번째 줄부터 단어가 있어야 합니다. | ${path}`);
        return;
      }
      this.keywords = kws;
      this.csvPath = path;
      this.csvSource = source ?? 'user';
      if (source === 'embedded') {
        this.addLog(`✅ 프로그램 내장 단어 목록 로드: ${kws.length}개`);
      } else if (source === 'default_file') {
        this.addLog(`✅ default.csv 로드: ${kws.length}개`);
      } else {
        this.addLog(`✅ CSV 로드 완료: ${kws.length}개 | ${path}`);
      }
    },

    // ── 파일 목록 ─────────────────────────────────────
    addFiles(paths) {
      const existing = new Set(this.files.map(f => f.path));
      let added = 0;
      let dupes = 0;
      let skipped = 0;

      for (const path of paths) {
        if (!['pdf', 'xlsx'].includes(extensionOf(path))) { skipped++; continue; }
        // 한 번의 호출에 같은 경로가 두 번 들어와도 걸러야 한다 —
        // 중복 항목 둘이 같은 output_ 경로를 두고 서로를 덮어쓴다.
        if (existing.has(path)) { dupes++; continue; }
        existing.add(path);
        this.files.push({ id: this.nextId++, name: fileNameOf(path), path, status: '대기' });
        added++;
      }

      // 조용히 버리면 사용자는 앱이 고장 난 줄 안다(.hwp·.xls를 자주 넣는다).
      if (added) this.addLog(`📂 ${added}개 파일 추가됨.`);
      if (dupes) this.addLog(`ℹ️ 이미 목록에 있는 ${dupes}개는 건너뛰었습니다.`);
      if (skipped) this.addLog(`⚠️ 지원하지 않는 형식 ${skipped}개는 제외했습니다. (PDF, XLSX만 가능)`);
    },

    async selectFiles() {
      try {
        const paths = await open({
          filters: [{ name: '지원 파일', extensions: ['pdf', 'xlsx'] }],
          multiple: true,
        });
        if (paths) this.addFiles(Array.isArray(paths) ? paths : [paths]);
      } catch (e) {
        this.addLog(`❌ 파일 선택 실패: ${e}`);
      }
    },

    removeFile(id) {
      const idx = this.files.findIndex(f => f.id === id);
      if (idx !== -1) {
        this.addLog(`🗑 '${this.files[idx].name}' 파일 제외.`);
        this.files.splice(idx, 1);
      }
    },

    clearFiles() {
      this.files = [];
      this.addLog('🗑 파일 목록 전체 초기화.');
    },

    updateFileStatus(id, status) {
      const file = this.files.find(f => f.id === id);
      if (file) file.status = status;
    },

    // ── 처리 ─────────────────────────────────────────
    async startProcessing() {
      if (this.isProcessing) return;
      if (this.keywords.length === 0 || this.files.length === 0) return;

      this.isProcessing = true;
      this.stopRequested = false;
      this.files.forEach(f => (f.status = '대기'));
      this.addLog('🚀 처리 시작');
      this.activeTab = 2; // 로그 탭으로 이동

      // 대상 목록·단어 목록을 시작 시점에 고정한다. 처리 중 드래그앤드롭으로
      // 목록이 바뀌어도 이번 실행에 끌려 들어가거나, 파일마다 다른 단어
      // 목록이 적용되는 일이 없다.
      const queue = [...this.files];
      const keywords = [...this.keywords];
      const detectConsecutiveSpaces = this.detectConsecutiveSpaces;
      let cursor = 0;

      let worker;
      try {
        worker = new Worker(
          new URL('../workers/processor.worker.js', import.meta.url),
          { type: 'module' }
        );
      } catch (e) {
        this.addLog(`❌ 처리기를 시작하지 못했습니다: ${e}`);
        this._cleanup();
        return;
      }
      this._worker = worker;

      // 진행 중인 디스크 쓰기. 메시지 이벤트는 핸들러의 Promise를 기다려 주지
      // 않으므로, 이것을 세지 않으면 저장이 끝나기 전에 done이 처리된다.
      const pendingWrites = new Set();

      // 이 실행이 아직 유효한가 — 중지했거나 워커가 죽었으면 더 보내지 않는다.
      const alive = () => !this.stopRequested && this._worker === worker;

      // 워커가 한 건을 끝낼 때마다 다음 파일을 보낸다(pull 방식).
      // 전부 밀어 넣으면 파일 수만큼의 바이트가 동시에 메모리에 올라가고,
      // 큐에 들어간 뒤에는 중지도 듣지 않는다.
      const sendNext = async () => {
        while (cursor < queue.length) {
          if (!alive()) return;
          const file = queue[cursor++];
          try {
            const bytes = await invoke('read_file_bytes', { path: file.path });
            if (!alive()) return;
            const ext = extensionOf(file.path);
            const outputPath = outputPathFor(file.path);
            const data = new Uint8Array(bytes);
            worker.postMessage(
              { type: 'process', id: file.id, name: file.name, ext, outputPath, data, keywords, detectConsecutiveSpaces },
              [data.buffer]
            );
            return; // 다음 파일은 워커의 ready 신호를 받고 보낸다
          } catch (e) {
            this.updateFileStatus(file.id, '실패');
            this.addLog(`❌ 파일 읽기 실패 [${file.name}]: ${e}`);
          }
        }
        if (alive()) worker.postMessage({ type: 'end' });
      };

      worker.onerror = (e) => {
        this.addLog(`❌ Worker 오류: ${e.message ?? e}`);
        this._cleanup();
      };

      worker.onmessageerror = (e) => {
        this.addLog(`❌ Worker 메시지 역직렬화 오류: ${e}`);
        this._cleanup();
      };

      worker.onmessage = async (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'ready':
            await sendNext();
            break;
          case 'progress':
            this.updateFileStatus(msg.id, msg.status);
            break;
          case 'log':
            this.addLog(msg.message);
            break;
          case 'result': {
            const write = (async () => {
              try {
                await invoke('write_file_bytes', { path: msg.outputPath, data: Array.from(msg.data) });
                this.updateFileStatus(msg.id, '성공');
                this.addLog(`✅ 저장 완료 → ${msg.outputPath}`);
              } catch (e) {
                this.updateFileStatus(msg.id, '실패');
                this.addLog(`❌ 저장 실패 [${msg.name}]: ${e}`);
              }
            })();
            pendingWrites.add(write);
            try {
              await write;
            } finally {
              pendingWrites.delete(write);
            }
            break;
          }
          case 'error':
            this.updateFileStatus(msg.id, '실패');
            this.addLog(`❌ 오류 [${msg.name}]: ${msg.message}`);
            break;
          case 'done':
            // 남은 저장이 끝나기 전에 완료를 알리면, 사용자는 "모든 처리 완료"를
            // 보고 창을 닫은 뒤에야 결과 파일이 없다는 것을 알게 된다.
            await Promise.allSettled([...pendingWrites]);
            this.addLog('✅ 모든 처리 완료.');
            this._cleanup();
            break;
        }
      };

      await sendNext();
    },

    stopProcessing() {
      if (!this.isProcessing) return;
      this.stopRequested = true;
      this.addLog('⛔ 사용자 요청으로 중단했습니다.');
      this.files.forEach(f => {
        if (f.status === '대기' || f.status === '처리중') f.status = '중단';
      });
      // 플래그만 세우면 이미 워커로 넘어간 작업은 끝까지 돈다 —
      // terminate로 진행 중인 것까지 즉시 멈춘다.
      this._cleanup();
    },

    _cleanup() {
      this._worker?.terminate();
      this._worker = null;
      this.isProcessing = false;
      this.stopRequested = false;
    },

    // ── 로그 ─────────────────────────────────────────
    addLog(message) {
      const now = new Date().toLocaleTimeString('ko-KR');
      this.logs.push(`[${now}] ${message}`);
      // 앱을 켜 둔 채 수백 파일을 여러 번 돌리면 배열과 DOM 노드가 계속 쌓인다.
      if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    },

    // ── 최신버전 확인 ────────────────────────────────
    async fetchLatestVersion() {
      // 탭을 오갈 때마다 부르면 인증 없는 GitHub API 시간당 60회 제한에 걸린다.
      // 학교처럼 여럿이 같은 공인 IP를 쓰면 더 빨리 걸린다.
      if (this.latestVersion !== null) return;

      try {
        const res = await fetch(RELEASES_API);
        // res.ok를 안 보면 rate limit(403)이나 404도 JSON 파싱에 성공한 뒤
        // tag_name === undefined로 흘러가 네트워크 오류와 구별되지 않는다.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.latestVersion = data.tag_name ?? '';
        this.latestReleaseUrl = data.html_url ?? '';
      } catch (e) {
        this.latestVersion = '';
        this.latestReleaseUrl = '';
        this.addLog(`⚠️ 최신버전 확인 실패: ${e}`);
      }
    },

    // ── 외부 링크 ─────────────────────────────────────
    async openUrl(url) {
      try {
        await openUrl(url);
      } catch (e) {
        this.addLog(`❌ 링크 열기 실패: ${e}`);
      }
    },
  },
});

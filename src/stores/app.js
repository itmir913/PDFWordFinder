import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { decodeCsvBytes, parseKeywords } from '../lib/csv.js';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

export const useAppStore = defineStore('app', {
  state: () => ({
    version: '',

    // CSV / 키워드
    csvPath: '',
    keywords: [],

    // 파일 목록
    files: [], // { id, name, path, status: '대기'|'처리중'|'성공'|'실패' }
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
    },

    // ── CSV ──────────────────────────────────────────
    async loadCsvFromPath(path) {
      try {
        const content = await invoke('read_file_bytes', { path });
        this._parseCsvBytes(content, path, 'user');
      } catch (e) {
        this.addLog(`❌ CSV 로드 실패: ${e}`);
        throw e;
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
        const { content, source } = await invoke('load_default_csv');
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
      for (const path of paths) {
        const ext = path.split('.').pop().toLowerCase();
        if (!['pdf', 'xlsx'].includes(ext)) continue;
        if (existing.has(path)) continue;
        const name = path.replace(/\\/g, '/').split('/').pop();
        this.files.push({ id: this.nextId++, name, path, status: '대기' });
        added++;
      }
      if (added) this.addLog(`📂 ${added}개 파일 추가됨.`);
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
      if (this.keywords.length === 0 || this.files.length === 0) return;

      this.isProcessing = true;
      this.stopRequested = false;
      this.files.forEach(f => (f.status = '대기'));
      this.addLog('🚀 처리 시작');
      this.activeTab = 2; // 로그 탭으로 이동

      this._worker = new Worker(
        new URL('../workers/processor.worker.js', import.meta.url),
        { type: 'module' }
      );

      this._worker.onerror = (e) => {
        this.addLog(`❌ Worker 오류: ${e.message ?? e}`);
        this._cleanup();
      };

      this._worker.onmessageerror = (e) => {
        this.addLog(`❌ Worker 메시지 역직렬화 오류: ${e}`);
        this._cleanup();
      };

      this._worker.onmessage = async (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            this.updateFileStatus(msg.id, msg.status);
            break;
          case 'log':
            this.addLog(msg.message);
            break;
          case 'result':
            try {
              await invoke('write_file_bytes', { path: msg.outputPath, data: Array.from(msg.data) });
              this.updateFileStatus(msg.id, '성공');
              this.addLog(`✅ 완료 → ${msg.outputPath}`);
            } catch (e) {
              this.updateFileStatus(msg.id, '실패');
              this.addLog(`❌ 저장 실패 [${msg.name}]: ${e}`);
            }
            break;
          case 'error':
            this.updateFileStatus(msg.id, '실패');
            this.addLog(`❌ 오류 [${msg.name}]: ${msg.message}`);
            break;
          case 'done':
            this.addLog('✅ 모든 처리 완료.');
            this._cleanup();
            break;
        }
      };

      // 각 파일 바이트 읽기 → 워커로 전송
      for (const file of this.files) {
        if (this.stopRequested) {
          this.addLog('⛔ 사용자에 의해 중지되었습니다.');
          break;
        }
        try {
          const bytes = await invoke('read_file_bytes', { path: file.path });
          const ext = file.name.split('.').pop().toLowerCase();
          const outputPath = file.path.replace(/[^/\\]+$/, `output_${file.name}`);
          const data = new Uint8Array(bytes);
          this._worker.postMessage(
            { type: 'process', id: file.id, name: file.name, ext, outputPath, data, keywords: [...this.keywords], detectConsecutiveSpaces: this.detectConsecutiveSpaces },
            [data.buffer]
          );
        } catch (e) {
          this.updateFileStatus(file.id, '실패');
          this.addLog(`❌ 파일 읽기 실패 [${file.name}]: ${e}`);
        }
      }

      this._worker.postMessage({ type: 'flush' });
    },

    stopProcessing() {
      this.stopRequested = true;
      this.addLog('⛔ 중지 요청...');
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
    },

    // ── 최신버전 확인 ────────────────────────────────
    async fetchLatestVersion() {
      try {
        const res = await fetch('https://api.github.com/repos/itmir913/WordFinderApp/releases/latest');
        const data = await res.json();
        this.latestVersion = data.tag_name ?? '';
        this.latestReleaseUrl = data.html_url ?? '';
      } catch {
        this.latestVersion = '';
        this.latestReleaseUrl = '';
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

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss()],

  build: {
    // scripts/check-architecture.mjs가 lookbehind를 막는 이유와 같은 하한이다.
    // Vite 6의 기본 타깃(baseline-widely-available = safari16)은 이 앱이
    // 지원하려는 Safari 16.4 미만 WKWebView보다 높다.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
  },
  // TAURI_ENV_* 를 프런트엔드에서 읽을 수 있게 한다 (Tauri 템플릿 기본값).
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: {
    global: "globalThis",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

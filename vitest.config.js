import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.js'],
    environment: 'node',
    // pdfjs로 여러 문서를 열고 닫는 통합 테스트가 있어 기본 5초로는 빠듯하다.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text-summary', 'text'],
    },
  },
});

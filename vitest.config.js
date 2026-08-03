import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Configuração do smoke automatizado.
 *
 * Não usa o plugin da Base44: o smoke não pode depender de serviço externo.
 * Nenhuma variável de ambiente real é injetada — os testes controlam
 * `import.meta.env` por stub.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/smoke/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/smoke/setup.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

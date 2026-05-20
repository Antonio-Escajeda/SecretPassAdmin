import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      'argon2id': new URL('./src/__tests__/argon2id-node.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})

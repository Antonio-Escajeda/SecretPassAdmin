import { defineConfig } from "vite";
import { resolve } from "node:path";

// argon2id uses the WebAssembly ESM integration proposal (import x from '*.wasm')
// which Rollup 4 / Vite 5 cannot bundle. We alias the package to a local shim
// that loads the same WASM files via fetch() using Vite's ?url asset handling.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^argon2id$/,
        replacement: resolve(__dirname, "src/argon2id-loader.ts"),
      },
    ],
  },
  optimizeDeps: {
    exclude: ["argon2id"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});

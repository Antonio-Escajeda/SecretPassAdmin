import simdUrl from "../node_modules/argon2id/dist/simd.wasm?url";
import noSimdUrl from "../node_modules/argon2id/dist/no-simd.wasm?url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no types for internal module
import setupWasm from "../node_modules/argon2id/lib/setup.js";

const loadWasm = () =>
  setupWasm(
    (importObject: WebAssembly.Imports) =>
      WebAssembly.instantiateStreaming(fetch(simdUrl), importObject),
    (importObject: WebAssembly.Imports) =>
      WebAssembly.instantiateStreaming(fetch(noSimdUrl), importObject)
  );

export default loadWasm;

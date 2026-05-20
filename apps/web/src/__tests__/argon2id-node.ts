import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(__dirname, '../../node_modules/argon2id')

function makeWasmLoader(wasmPath: string) {
  return async (importObject: WebAssembly.Imports): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
    const buf = readFileSync(wasmPath)
    return WebAssembly.instantiate(buf, importObject)
  }
}

export default async function loadWasm() {
  const { default: setupWasm } = await import(/* @vite-ignore */ join(pkgDir, 'lib/setup.js'))
  const getSIMD = makeWasmLoader(join(pkgDir, 'dist/simd.wasm'))
  const getNonSIMD = makeWasmLoader(join(pkgDir, 'dist/no-simd.wasm'))
  return setupWasm(getSIMD, getNonSIMD)
}

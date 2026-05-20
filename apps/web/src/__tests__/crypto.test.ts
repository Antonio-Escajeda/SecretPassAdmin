import { describe, it, expect } from 'vitest'
import {
  base64urlEncode,
  base64urlDecode,
  encryptSecret,
  decryptSecret,
  encryptSecretWithArgon2id,
  decryptSecretWithArgon2id,
} from '../crypto.js'

// ── base64url encode/decode ────────────────────────────────────────────────
describe('base64urlEncode / base64urlDecode', () => {
  it('roundtrip — encode then decode returns original bytes', () => {
    const original = new Uint8Array([104, 101, 108, 108, 111]) // "hello"
    const encoded = base64urlEncode(original)
    const decoded = base64urlDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  it('output has no +, /, or = characters', () => {
    // Use enough bytes to guarantee base64 padding would normally appear
    const bytes = new Uint8Array(32).fill(255)
    const encoded = base64urlEncode(bytes)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })

  it('roundtrip with ArrayBuffer input', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5])
    const encoded = base64urlEncode(original.buffer)
    const decoded = base64urlDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })
})

// ── encryptSecret ──────────────────────────────────────────────────────────
describe('encryptSecret', () => {
  it('returns ciphertext, iv, key — all valid base64url strings', async () => {
    const result = await encryptSecret('hello world')
    expect(result).toHaveProperty('ciphertext')
    expect(result).toHaveProperty('iv')
    expect(result).toHaveProperty('key')
    expect(result.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.iv).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.key).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('unique IVs across multiple calls', async () => {
    const r1 = await encryptSecret('same text')
    const r2 = await encryptSecret('same text')
    expect(r1.iv).not.toBe(r2.iv)
  })
})

// ── decryptSecret ──────────────────────────────────────────────────────────
describe('decryptSecret', () => {
  it('roundtrip — decrypt returns original plaintext', async () => {
    const plaintext = 'super secret value'
    const { ciphertext, iv, key } = await encryptSecret(plaintext)
    const decrypted = await decryptSecret({ ciphertext, iv, key })
    expect(decrypted).toBe(plaintext)
  })

  it('wrong key → rejects', async () => {
    const { ciphertext, iv } = await encryptSecret('some secret')
    const { key: wrongKey } = await encryptSecret('other')
    await expect(decryptSecret({ ciphertext, iv, key: wrongKey })).rejects.toThrow()
  })

  it('unicode roundtrip', async () => {
    const plaintext = '¡Hola! 🔐 こんにちは'
    const { ciphertext, iv, key } = await encryptSecret(plaintext)
    const decrypted = await decryptSecret({ ciphertext, iv, key })
    expect(decrypted).toBe(plaintext)
  })
})

// ── encryptSecretWithArgon2id ──────────────────────────────────────────────
describe('encryptSecretWithArgon2id', () => {
  it('returns ciphertext, iv, key, salt — all valid base64url strings', async () => {
    const result = await encryptSecretWithArgon2id('my secret', 'my passphrase')
    expect(result).toHaveProperty('ciphertext')
    expect(result).toHaveProperty('iv')
    expect(result).toHaveProperty('key')
    expect(result).toHaveProperty('salt')
    expect(result.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.iv).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.key).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(result.salt).toMatch(/^[A-Za-z0-9_-]+$/)
  }, 10000)

  it('salt is different across calls', async () => {
    const r1 = await encryptSecretWithArgon2id('same', 'pass')
    const r2 = await encryptSecretWithArgon2id('same', 'pass')
    expect(r1.salt).not.toBe(r2.salt)
  }, 15000)
})

// ── decryptSecretWithArgon2id ──────────────────────────────────────────────
describe('decryptSecretWithArgon2id', () => {
  it('roundtrip — correct passphrase returns original plaintext', async () => {
    const plaintext = 'top secret'
    const passphrase = 'correct-horse-battery-staple'
    const { ciphertext, iv, key, salt } = await encryptSecretWithArgon2id(plaintext, passphrase)
    const decrypted = await decryptSecretWithArgon2id({ ciphertext, iv, key, salt, passphrase })
    expect(decrypted).toBe(plaintext)
  }, 15000)

  it('wrong passphrase → rejects', async () => {
    const { ciphertext, iv, key, salt } = await encryptSecretWithArgon2id('secret', 'correct-pass')
    await expect(
      decryptSecretWithArgon2id({ ciphertext, iv, key, salt, passphrase: 'wrong-pass' })
    ).rejects.toThrow()
  }, 15000)
})

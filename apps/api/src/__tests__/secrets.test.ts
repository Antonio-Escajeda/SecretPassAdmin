import { describe, it, expect, vi, beforeEach } from 'vitest'

// MANDATORY: vi.hoisted() to avoid TDZ with vi.mock factory
const mockRedis = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue('OK'),
  getdel: vi.fn(),
}))

vi.mock('ioredis', () => {
  function RedisMock() { return mockRedis }
  return { default: RedisMock }
})

import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { secretRoutes } from '../routes/secrets.routes.js'
import { hashId } from '../audit.js'

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' })
  await app.register(secretRoutes)
  return app
}

// ── Schema validation ──────────────────────────────────────────────────────
describe('createSecretSchema validation', () => {
  it('valid payload passes', async () => {
    const app = await buildApp()
    mockRedis.set.mockResolvedValueOnce('OK')
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: {
        ciphertext: 'dGVzdA',
        iv: 'AQEBAQEBAQEBAQEB',
        ttlSeconds: 3600,
      },
    })
    expect(res.statusCode).toBe(201)
  })

  it('missing ciphertext → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { iv: 'AQEBAQEBAQEBAQEB', ttlSeconds: 3600 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('iv too short → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ciphertext: 'dGVzdA', iv: 'short', ttlSeconds: 3600 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ttlSeconds below MIN → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ciphertext: 'dGVzdA', iv: 'AQEBAQEBAQEBAQEB', ttlSeconds: 1 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ttlSeconds above MAX → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ciphertext: 'dGVzdA', iv: 'AQEBAQEBAQEBAQEB', ttlSeconds: 9999999 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('invalid base64url chars in ciphertext → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ciphertext: 'test==invalid++', iv: 'AQEBAQEBAQEBAQEB', ttlSeconds: 3600 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('salt with invalid base64url chars → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: {
        ciphertext: 'dGVzdA',
        iv: 'AQEBAQEBAQEBAQEB',
        salt: 'invalid+salt/chars==',
        ttlSeconds: 3600,
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── POST /api/secrets ──────────────────────────────────────────────────────
describe('POST /api/secrets', () => {
  beforeEach(() => {
    mockRedis.set.mockResolvedValue('OK')
  })

  it('valid payload without salt → 201 + {id, expiresAt}', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { ciphertext: 'dGVzdA', iv: 'AQEBAQEBAQEBAQEB', ttlSeconds: 3600 },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('expiresAt')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThanOrEqual(20)
  })

  it('valid payload WITH salt → 201 + {id, expiresAt}', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: {
        ciphertext: 'dGVzdA',
        iv: 'AQEBAQEBAQEBAQEB',
        salt: 'AgICAgICAgICAgICAgICAg',
        ttlSeconds: 3600,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('expiresAt')
  })

  it('invalid payload → 400', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { not: 'valid' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── POST /api/secrets/:id/reveal ───────────────────────────────────────────
describe('POST /api/secrets/:id/reveal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exists → 200 with secret payload', async () => {
    const app = await buildApp()
    const fakePayload = JSON.stringify({
      version: 1,
      algorithm: 'AES-256-GCM',
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      salt: null,
      hasPassphrase: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      maxViews: 1,
    })
    mockRedis.getdel.mockResolvedValueOnce(fakePayload)

    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets/abcdefghijklmnopqrstuvwxyz123456/reveal',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ciphertext).toBe('dGVzdA')
  })

  it('not found (getdel returns null) → 404', async () => {
    const app = await buildApp()
    mockRedis.getdel.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets/abcdefghijklmnopqrstuvwxyz123456/reveal',
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Secret not found or already viewed')
  })

  it('invalid format ID → 404 (NOT 400 — timing fix)', async () => {
    const app = await buildApp()
    // getdel for __invalid__ returns null
    mockRedis.getdel.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/secrets/!!!invalid!!!id/reveal',
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('Secret not found or already viewed')
  })

  it('redis.getdel is called even for invalid format IDs (with secret:__invalid__ key)', async () => {
    const app = await buildApp()
    mockRedis.getdel.mockResolvedValueOnce(null)

    await app.inject({
      method: 'POST',
      url: '/api/secrets/!!!invalid!!!id/reveal',
    })

    expect(mockRedis.getdel).toHaveBeenCalledWith('secret:__invalid__')
  })
})

// ── audit.ts hashId ────────────────────────────────────────────────────────
describe('hashId', () => {
  it('output is always exactly 16 hex chars', () => {
    const inputs = ['abc', 'some-id-123', 'x'.repeat(100), '']
    for (const input of inputs) {
      const result = hashId(input)
      expect(result).toMatch(/^[0-9a-f]{16}$/)
      expect(result.length).toBe(16)
    }
  })
})

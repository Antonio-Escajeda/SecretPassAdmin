import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// MANDATORY: vi.hoisted() to avoid TDZ con vi.mock factory
const mockRedis = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue('OK'),
  getdel: vi.fn(),
  incr: vi.fn().mockResolvedValue(1),    // rate limiter: count=1 → under limit
  pexpire: vi.fn().mockResolvedValue(1),
}))

vi.mock('../redis.js', () => ({ redis: mockRedis }))

import { secretRoutes } from '../routes/secrets.routes.js'
import { parseBody, sendJson, getIp, applySecurityHeaders, generateRequestId } from '../http.js'
import { hashId } from '../audit.js'

const routes = secretRoutes()

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (req, res) => {
    const id = generateRequestId()
    const method = req.method ?? 'GET'
    const url = (req.url ?? '/').split('?').at(0) ?? '/'
    const ip = getIp(req)

    applySecurityHeaders(res, id)

    let body: unknown = null
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        body = await parseBody(req)
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'Bad request' })
        return
      }
    }

    const handled = await routes.dispatch({ req, res, method, url, ip, id, body, params: {} })
    if (!handled) sendJson(res, 404, { error: 'Not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

type InjectResult = { statusCode: number; json: () => unknown }

async function inject(
  baseUrl: string,
  method: string,
  path: string,
  payload?: unknown
): Promise<InjectResult> {
  const init: RequestInit = {
    method,
    headers: payload !== undefined ? { 'Content-Type': 'application/json' } : {},
  }
  if (payload !== undefined) {
    init.body = JSON.stringify(payload)
  }
  const res = await fetch(`${baseUrl}${path}`, init)
  const json = await res.json().catch(() => null)
  return { statusCode: res.status, json: () => json }
}

// ── Schema validation ──────────────────────────────────────────────────────
describe('createSecretSchema validation', () => {
  let baseUrl: string
  let server: Server

  beforeEach(async () => {
    mockRedis.set.mockResolvedValue('OK')
    ;({ server, baseUrl } = await startServer())
  })

  it('valid payload passes', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(201)
    server.close()
  })

  it('missing ciphertext → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })

  it('iv too short → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'short',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })

  it('ttlSeconds below MIN → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 1,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })

  it('ttlSeconds above MAX → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 9999999,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })

  it('invalid base64url chars in ciphertext → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'test==invalid++',
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })

  it('salt with invalid base64url chars → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      salt: 'invalid+salt/chars==',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(400)
    server.close()
  })
})

// ── POST /api/secrets ──────────────────────────────────────────────────────
describe('POST /api/secrets', () => {
  let baseUrl: string
  let server: Server

  beforeEach(async () => {
    mockRedis.set.mockResolvedValue('OK')
    ;({ server, baseUrl } = await startServer())
  })

  it('valid payload without salt → 201 + {id, expiresAt}', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('expiresAt')
    expect(typeof body['id']).toBe('string')
    expect((body['id'] as string).length).toBeGreaterThanOrEqual(20)
    server.close()
  })

  it('valid payload WITH salt → 201 + {id, expiresAt}', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', {
      ciphertext: 'dGVzdA',
      iv: 'AQEBAQEBAQEBAQEB',
      salt: 'AgICAgICAgICAgICAgICAg',
      ttlSeconds: 3600,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('expiresAt')
    server.close()
  })

  it('invalid payload → 400', async () => {
    const res = await inject(baseUrl, 'POST', '/api/secrets', { not: 'valid' })
    expect(res.statusCode).toBe(400)
    server.close()
  })
})

// ── POST /api/secrets/:id/reveal ───────────────────────────────────────────
describe('POST /api/secrets/:id/reveal', () => {
  let baseUrl: string
  let server: Server

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRedis.incr.mockResolvedValue(1)
    mockRedis.pexpire.mockResolvedValue(1)
    ;({ server, baseUrl } = await startServer())
  })

  it('exists → 200 with secret payload', async () => {
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

    const res = await inject(baseUrl, 'POST', '/api/secrets/abcdefghijklmnopqrstuvwxyz123456/reveal')
    expect(res.statusCode).toBe(200)
    const body = res.json() as Record<string, unknown>
    expect(body['ciphertext']).toBe('dGVzdA')
    server.close()
  })

  it('not found (getdel returns null) → 404', async () => {
    mockRedis.getdel.mockResolvedValueOnce(null)

    const res = await inject(baseUrl, 'POST', '/api/secrets/abcdefghijklmnopqrstuvwxyz123456/reveal')
    expect(res.statusCode).toBe(404)
    const body = res.json() as Record<string, unknown>
    expect(body['error']).toBe('Secret not found or already viewed')
    server.close()
  })

  it('invalid format ID → 404 (NOT 400 — timing fix)', async () => {
    mockRedis.getdel.mockResolvedValueOnce(null)

    const res = await inject(baseUrl, 'POST', '/api/secrets/!!!invalid!!!id/reveal')
    expect(res.statusCode).toBe(404)
    const body = res.json() as Record<string, unknown>
    expect(body['error']).toBe('Secret not found or already viewed')
    server.close()
  })

  it('redis.getdel is called even for invalid format IDs (with secret:__invalid__ key)', async () => {
    mockRedis.getdel.mockResolvedValueOnce(null)

    await inject(baseUrl, 'POST', '/api/secrets/!!!invalid!!!id/reveal')

    expect(mockRedis.getdel).toHaveBeenCalledWith('secret:__invalid__')
    server.close()
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

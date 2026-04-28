# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Contact: 01100001.01100101@protonmail.com

Include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

You will receive a response within 72 hours. Once the vulnerability is confirmed and fixed, a disclosure timeline will be agreed upon.

## Scope

The following are in scope:

- `apps/api` — REST API (Fastify + Node.js)
- `apps/web` — Frontend (React + Vite served by nginx)
- Docker and infrastructure configuration

The following are out of scope:

- Denial of service attacks
- Social engineering
- Attacks requiring physical access

## Security Controls

### Transport and Headers

- HTTPS enforced in production via TLS guard (redirects HTTP to HTTPS with 301)
- `Strict-Transport-Security` header enabled
- `server_tokens off` — nginx version not exposed
- `X-Frame-Options: DENY` — clickjacking protection
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` restricts camera, microphone and geolocation

### Content Security Policy

API responses and frontend pages include a strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self';
frame-ancestors 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
```

### Input Validation

- All request bodies validated with Zod schemas
- Strict regex on secret IDs: `[A-Za-z0-9_-]{20,80}`
- Payload size limited by `MAX_SECRET_BYTES` (default 64 KB)
- Validation error details hidden in production

### Rate Limiting

- `POST /api/secrets`: 50 requests per hour per IP
- `POST /api/secrets/:id/reveal`: 300 requests per hour per IP
- Global limit: 500 requests per minute per IP
- `Retry-After` included in 429 responses

### Secrets Storage

- Secrets stored encrypted (AES-256-GCM) — the server never receives the plaintext
- Optional passphrase-derived key via PBKDF2
- One-time view enforced via atomic `GETDEL` in Redis — race conditions not possible
- TTL enforced by Redis — secrets auto-deleted on expiry
- No secrets logged (redacted in logger config)

### CORS

- CORS disabled (`origin: false`) — browser blocks all cross-origin reads

### Prototype Pollution

- Blocked natively by Fastify's JSON parser

### Observability

- `X-Request-ID` on all responses for traceability
- `/metrics` endpoint restricted to localhost in production
- Audit log for all secret lifecycle events (created, revealed, not found) using hashed IDs

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | Yes       |

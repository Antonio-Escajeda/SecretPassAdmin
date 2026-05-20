import { randomBytes } from "node:crypto";
import { redis } from "../redis.js";
import { createSecretSchema } from "../schemas.js";
import { audit, hashId } from "../audit.js";
import { config } from "../config.js";
import { sendJson } from "../http.js";
import { checkRateLimit } from "../ratelimit.js";
import { increment } from "../metrics.js";
import type { Context } from "../http.js";

function generateId(size = 32): string {
  return randomBytes(Math.ceil(size * 0.75)).toString("base64url").slice(0, size);
}

const ID_REGEX = /^[A-Za-z0-9_-]{20,80}$/;

async function handleCreateSecret(ctx: Context): Promise<void> {
  const { res, ip } = ctx;

  const rl = await checkRateLimit(ip, { max: 50, windowMs: 3_600_000, routeKey: "create" });
  res.setHeader("x-ratelimit-limit", rl.limit);
  res.setHeader("x-ratelimit-remaining", rl.remaining);
  res.setHeader("x-ratelimit-reset", rl.resetSeconds);

  if (!rl.allowed) {
    audit("secret.rate_limited", { ip });
    sendJson(res, 429, {
      statusCode: 429,
      error: "Too Many Requests",
      message: "Too many secrets created. Try again later.",
      retryAfter: rl.resetSeconds,
    });
    increment("http_requests_total", { method: "POST", route: "/api/secrets", status_code: "429" });
    return;
  }

  const result = createSecretSchema.safeParse(ctx.body);

  if (!result.success) {
    audit("secret.invalid_payload", { ip });
    const body: Record<string, unknown> = { error: "Invalid payload" };
    if (config.NODE_ENV !== "production") body.issues = result.error.issues;
    sendJson(res, 400, body);
    increment("http_requests_total", { method: "POST", route: "/api/secrets", status_code: "400" });
    return;
  }

  const { ciphertext, iv, salt, ttlSeconds } = result.data;
  const id = generateId(32);
  const key = `secret:${id}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const payload = JSON.stringify({
    version: 1,
    algorithm: "AES-256-GCM",
    kdf: "argon2id",
    ciphertext,
    iv,
    salt: salt ?? null,
    hasPassphrase: !!salt,
    createdAt: now.toISOString(),
    expiresAt,
    maxViews: 1,
  });

  await redis.set(key, payload, "EX", ttlSeconds);
  audit("secret.created", { secretIdHash: hashId(id), ttlSeconds, expiresAt, ip });

  sendJson(res, 201, { id, expiresAt });
  increment("http_requests_total", { method: "POST", route: "/api/secrets", status_code: "201" });
}

async function handleRevealSecret(ctx: Context): Promise<void> {
  const { res, ip, params } = ctx;
  const id = params["id"] ?? "";

  const rl = await checkRateLimit(ip, { max: 300, windowMs: 3_600_000, routeKey: "reveal" });
  res.setHeader("x-ratelimit-limit", rl.limit);
  res.setHeader("x-ratelimit-remaining", rl.remaining);
  res.setHeader("x-ratelimit-reset", rl.resetSeconds);

  if (!rl.allowed) {
    sendJson(res, 429, {
      statusCode: 429,
      error: "Too Many Requests",
      message: "Too many requests. Try again later.",
      retryAfter: rl.resetSeconds,
    });
    increment("http_requests_total", { method: "POST", route: "/api/secrets/:id/reveal", status_code: "429" });
    return;
  }

  const isValidFormat = ID_REGEX.test(id);
  const redisKey = isValidFormat ? `secret:${id}` : `secret:__invalid__`;
  const rawSecret = await redis.getdel(redisKey);

  if (!isValidFormat || rawSecret === null) {
    audit("secret.not_found", {
      secretIdHash: isValidFormat ? hashId(id) : "invalid_format",
      ip,
    });
    sendJson(res, 404, { error: "Secret not found or already viewed" });
    increment("http_requests_total", { method: "POST", route: "/api/secrets/:id/reveal", status_code: "404" });
    return;
  }

  audit("secret.revealed", { secretIdHash: hashId(id), ip });
  res.setHeader("Cache-Control", "no-store");
  sendJson(res, 200, JSON.parse(rawSecret) as unknown);
  increment("http_requests_total", { method: "POST", route: "/api/secrets/:id/reveal", status_code: "200" });
}

export function secretRoutes() {
  const revealRegex = /^\/api\/secrets\/([^/]+)\/reveal$/;

  return {
    async dispatch(ctx: Context): Promise<boolean> {
      const { method, url } = ctx;

      if (method === "POST" && url === "/api/secrets") {
        await handleCreateSecret(ctx);
        return true;
      }

      const revealMatch = revealRegex.exec(url);
      if (method === "POST" && revealMatch) {
        ctx.params = { id: revealMatch[1] ?? "" };
        await handleRevealSecret(ctx);
        return true;
      }

      return false;
    },
  };
}

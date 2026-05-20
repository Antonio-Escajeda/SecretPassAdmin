import { redis } from "./redis.js";

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  routeKey: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export async function checkRateLimit(
  ip: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / opts.windowMs);
  const key = `ratelimit:${opts.routeKey}:${ip}:${window}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, opts.windowMs);
  }

  const resetSeconds = Math.ceil(((window + 1) * opts.windowMs - Date.now()) / 1000);

  return {
    allowed: count <= opts.max,
    limit: opts.max,
    remaining: Math.max(0, opts.max - count),
    resetSeconds,
  };
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const num = Number(val);
  if (!Number.isFinite(num)) throw new Error(`Env var ${key} must be a number, got: ${val}`);
  return num;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  throw new Error(`Env var ${key} must be true/false/1/0, got: ${val}`);
}

const NODE_ENV_raw = envStr("NODE_ENV", "development");
if (!["development", "test", "production"].includes(NODE_ENV_raw)) {
  throw new Error(`Env var NODE_ENV must be development, test, or production. Got: ${NODE_ENV_raw}`);
}

export const config = {
  NODE_ENV: NODE_ENV_raw as "development" | "test" | "production",
  PORT: envNum("PORT", 3000),
  REDIS_URL: envStr("REDIS_URL", "redis://localhost:6379"),
  MAX_SECRET_BYTES: envNum("MAX_SECRET_BYTES", 65536),
  MIN_TTL_SECONDS: envNum("MIN_TTL_SECONDS", 60),
  MAX_TTL_SECONDS: envNum("MAX_TTL_SECONDS", 604800),
  TRUST_PROXY: envBool("TRUST_PROXY", false),
  REDIS_PASSWORD: process.env["REDIS_PASSWORD"],
};

import { createHash } from "node:crypto";
import pino from "pino";

const auditLogger = pino({ name: "audit" });

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

export type AuditEvent =
  | "secret.created"
  | "secret.revealed"
  | "secret.not_found"
  | "secret.invalid_payload"
  | "secret.rate_limited";

export function audit(event: AuditEvent, data: {
  secretIdHash?: string;
  ttlSeconds?: number;
  ip?: string;
  userAgentHash?: string;
  expiresAt?: string;
}) {
  auditLogger.info({ event, ...data });
}

export { hashId };

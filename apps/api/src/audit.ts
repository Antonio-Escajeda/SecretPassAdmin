import { createHash } from "node:crypto";

const auditLogger = {
  info: (data: object) =>
    process.stdout.write(
      JSON.stringify({ level: "info", name: "audit", time: Date.now(), ...data }) + "\n"
    ),
};

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

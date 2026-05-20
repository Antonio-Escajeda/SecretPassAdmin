import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";

const BODY_LIMIT = Math.ceil(config.MAX_SECRET_BYTES * (4 / 3)) + 4096;

export interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: string;
  ip: string;
  id: string;
  body: unknown;
  params: Record<string, string>;
}

export function getIp(req: IncomingMessage): string {
  if (config.TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return (forwarded.split(",").at(0) ?? "").trim();
    }
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      data += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!data) { resolve(null); return; }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function applySecurityHeaders(res: ServerResponse, requestId: string): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Request-ID", requestId);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  );
}

let counter = 0;
export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${(++counter).toString(36)}`;
}

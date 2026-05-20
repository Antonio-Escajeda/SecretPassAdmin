import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { config } from "./config.js";

// Sentinel para indicar que el buffer no tiene un mensaje completo todavía
const INCOMPLETE = Symbol("incomplete");

// ─── Parser RESP2 ────────────────────────────────────────────────────────────
class RespParser {
  private buf = "";

  feed(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
  }

  // Intenta extraer un valor completo del buffer.
  // Devuelve INCOMPLETE si faltan datos, Error para errores Redis, o el valor.
  tryRead(): unknown {
    const result = this.parse(0);
    if (result === null) return INCOMPLETE;
    const [value, consumed] = result;
    this.buf = this.buf.slice(consumed);
    return value;
  }

  private parse(offset: number): [unknown, number] | null {
    if (offset >= this.buf.length) return null;
    const type = this.buf[offset];

    // Simple string (+), error (-), integer (:)
    if (type === "+" || type === "-" || type === ":") {
      const eol = this.buf.indexOf("\r\n", offset + 1);
      if (eol === -1) return null;
      const content = this.buf.slice(offset + 1, eol);
      if (type === "-") return [new Error(content), eol + 2];
      if (type === ":") return [parseInt(content, 10), eol + 2];
      return [content, eol + 2];
    }

    // Bulk string ($)
    if (type === "$") {
      const eol = this.buf.indexOf("\r\n", offset + 1);
      if (eol === -1) return null;
      const len = parseInt(this.buf.slice(offset + 1, eol), 10);
      if (len === -1) return [null, eol + 2]; // RESP null
      const dataStart = eol + 2;
      const dataEnd = dataStart + len;
      if (this.buf.length < dataEnd + 2) return null; // datos incompletos
      return [this.buf.slice(dataStart, dataEnd), dataEnd + 2];
    }

    return null;
  }
}

// ─── Cliente RESP2 ────────────────────────────────────────────────────────────
interface Pending {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

class RedisClient {
  private socket: Socket | null = null;
  private parser = new RespParser();
  private queue: Pending[] = [];
  private connectPromise: Promise<void> | null = null;
  private readonly redisUrl: URL;
  private readonly password: string | undefined;

  constructor(url: string, password?: string) {
    this.redisUrl = new URL(url);
    this.password = password;
  }

  private ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const host = this.redisUrl.hostname || "localhost";
      const port = parseInt(this.redisUrl.port || "6379", 10);

      const socket = createConnection({ host, port });
      socket.setKeepAlive(true, 10_000);

      socket.on("error", (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on("close", () => {
        this.socket = null;
        // Rechaza comandos pendientes
        const pending = this.queue.splice(0);
        for (const p of pending) {
          p.reject(new Error("Redis connection closed"));
        }
        // Reconecta después de 1 segundo
        setTimeout(() => this.ensureConnected().catch(() => {}), 1_000);
      });

      socket.on("connect", () => {
        if (this.password) {
          // AUTH manejado en aislamiento antes de habilitar el handler normal
          socket.write(this.serialize("AUTH", this.password));
          let authBuf = "";
          const onAuthData = (chunk: Buffer) => {
            authBuf += chunk.toString("utf8");
            if (!authBuf.includes("\r\n")) return;
            socket.off("data", onAuthData);
            if (authBuf.startsWith("+OK")) {
              this.socket = socket;
              socket.on("data", (c: Buffer) => this.onData(c));
              resolve();
            } else {
              socket.destroy();
              reject(new Error(`Redis AUTH failed: ${authBuf.trim()}`));
            }
          };
          socket.on("data", onAuthData);
        } else {
          this.socket = socket;
          socket.on("data", (c: Buffer) => this.onData(c));
          resolve();
        }
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.parser.feed(chunk);
    this.drain();
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const val = this.parser.tryRead();
      if (val === INCOMPLETE) break;
      const pending = this.queue.shift();
      if (!pending) break;
      if (val instanceof Error) {
        pending.reject(val);
      } else {
        pending.resolve(val);
      }
    }
  }

  private serialize(...args: (string | number)[]): string {
    let msg = `*${args.length}\r\n`;
    for (const arg of args) {
      const s = String(arg);
      msg += `$${Buffer.byteLength(s, "utf8")}\r\n${s}\r\n`;
    }
    return msg;
  }

  private async cmd(...args: (string | number)[]): Promise<unknown> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Redis not connected");
    return new Promise<unknown>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      socket.write(this.serialize(...args));
    });
  }

  // ─── API pública — solo los comandos que usa el proyecto ─────────────────
  incr(key: string): Promise<number> {
    return this.cmd("INCR", key) as Promise<number>;
  }

  pexpire(key: string, ms: number): Promise<number> {
    return this.cmd("PEXPIRE", key, ms) as Promise<number>;
  }

  set(key: string, value: string, ex: "EX", seconds: number): Promise<string> {
    return this.cmd("SET", key, value, ex, seconds) as Promise<string>;
  }

  getdel(key: string): Promise<string | null> {
    return this.cmd("GETDEL", key) as Promise<string | null>;
  }
}

export const redis = new RedisClient(config.REDIS_URL, config.REDIS_PASSWORD);

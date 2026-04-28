import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import metrics from "fastify-metrics";
import { config } from "./config.js";
import { secretRoutes } from "./routes/secrets.routes.js";

const fastify = Fastify({
  bodyLimit: Math.ceil(config.MAX_SECRET_BYTES * (4 / 3)) + 4096,
  trustProxy: config.TRUST_PROXY,
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: [
      "req.headers.authorization",
      "req.body.ciphertext",
      "res.body.ciphertext",
    ],
  },
});

await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});

await fastify.register(cors, {
  origin: false,
});

await fastify.register(rateLimit, {
  max: 500,
  timeWindow: "1 minute",
  addHeaders: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
  },
});

await fastify.register(metrics, { endpoint: "/metrics" });

// Proteger /metrics en producción — solo accesible desde localhost
fastify.addHook("onRequest", async (request, reply) => {
  if (request.url !== "/metrics") return;
  if (config.NODE_ENV !== "production") return;
  const ip = request.ip;
  if (ip !== "127.0.0.1" && ip !== "::1") {
    return reply.status(403).send({ error: "Forbidden" });
  }
});

fastify.addHook("onSend", async (request, reply) => {
  void reply.header("Cache-Control", "no-store");
  void reply.header("Pragma", "no-cache");
  void reply.header("Expires", "0");
  void reply.header("Referrer-Policy", "no-referrer");
  void reply.header("X-Content-Type-Options", "nosniff");
  void reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  void reply.header("X-Request-ID", request.id);
});

fastify.get("/health", async () => ({ ok: true }));

await fastify.register(secretRoutes);

// TRUST_PROXY warning
if (config.NODE_ENV === "production" && !config.TRUST_PROXY) {
  fastify.log.warn(
    "NODE_ENV=production but TRUST_PROXY=false — TLS termination may not be configured. Set TRUST_PROXY=true if running behind a reverse proxy."
  );
}

// TLS enforcement — only active in production
fastify.addHook("onRequest", async (request, reply) => {
  if (config.NODE_ENV !== "production") return;
  const proto = request.headers["x-forwarded-proto"];
  if (proto !== "https") {
    return reply.status(301).redirect(`https://${request.headers.host}${request.url}`);
  }
});

await fastify.listen({ host: "0.0.0.0", port: config.PORT });

import type { FastifyPluginAsync } from "fastify";
import { nanoid } from "nanoid";
import { redis } from "../redis.js";
import { createSecretSchema } from "../schemas.js";
import { audit, hashId } from "../audit.js";
import { config } from "../config.js";

const ID_REGEX = /^[A-Za-z0-9_-]{20,80}$/;

export const secretRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/secrets", {
    config: {
      rateLimit: {
        max: 50,
        timeWindow: "1 hour",
        errorResponseBuilder: (_request, context) => ({
          statusCode: 429,
          error: "Too Many Requests",
          message: "Too many secrets created. Try again later.",
          retryAfter: Math.ceil(context.ttl / 1000),
        }),
      },
    },
  }, async (request, reply) => {
    const result = createSecretSchema.safeParse(request.body);

    if (!result.success) {
      audit("secret.invalid_payload", { ip: request.ip });
      const body: Record<string, unknown> = { error: "Invalid payload" };
      if (config.NODE_ENV !== "production") body.issues = result.error.issues;
      return reply.status(400).send(body);
    }

    const { ciphertext, iv, salt, ttlSeconds } = result.data;
    const id = nanoid(32);
    const key = `secret:${id}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    const payload = JSON.stringify({
      version: 1,
      algorithm: "AES-256-GCM",
      ciphertext,
      iv,
      salt: salt ?? null,
      hasPassphrase: !!salt,
      createdAt: now.toISOString(),
      expiresAt,
      maxViews: 1,
    });

    await redis.set(key, payload, "EX", ttlSeconds);

    audit("secret.created", { secretIdHash: hashId(id), ttlSeconds, expiresAt, ip: request.ip });

    return reply.status(201).send({ id, expiresAt });
  });

  // POST instead of GET — bots (Slack, Teams) pre-fetch GET links, which would consume the secret
  fastify.post("/api/secrets/:id/reveal", {
    config: {
      rateLimit: {
        max: 300,
        timeWindow: "1 hour",
        errorResponseBuilder: (_request, context) => ({
          statusCode: 429,
          error: "Too Many Requests",
          message: "Too many requests. Try again later.",
          retryAfter: Math.ceil(context.ttl / 1000),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const isValidFormat = ID_REGEX.test(id);
    const redisKey = isValidFormat ? `secret:${id}` : `secret:__invalid__`;
    const rawSecret = await redis.getdel(redisKey);

    if (!isValidFormat || rawSecret === null) {
      audit("secret.not_found", { secretIdHash: isValidFormat ? hashId(id) : "invalid_format", ip: request.ip });
      return reply.status(404).send({ error: "Secret not found or already viewed" });
    }

    audit("secret.revealed", { secretIdHash: hashId(id), ip: request.ip });

    void reply.header("Cache-Control", "no-store");

    return reply.send(JSON.parse(rawSecret));
  });
};

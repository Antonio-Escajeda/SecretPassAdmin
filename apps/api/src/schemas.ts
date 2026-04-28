import { z } from "zod";
import { config } from "./config.js";

export const base64urlRegex = /^[A-Za-z0-9_-]+$/;

export const createSecretSchema = z.object({
  ciphertext: z
    .string()
    .regex(base64urlRegex)
    .max(Math.ceil(config.MAX_SECRET_BYTES * (4 / 3)) + 4),
  iv: z.string().regex(base64urlRegex).min(16).max(32),
  salt: z
    .string()
    .regex(base64urlRegex)
    .min(16)
    .max(32)
    .optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(config.MIN_TTL_SECONDS)
    .max(config.MAX_TTL_SECONDS),
});

export type CreateSecretInput = z.infer<typeof createSecretSchema>;

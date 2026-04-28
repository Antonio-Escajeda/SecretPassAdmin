import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MAX_SECRET_BYTES: z.coerce.number().default(65536),
  MIN_TTL_SECONDS: z.coerce.number().default(60),
  MAX_TTL_SECONDS: z.coerce.number().default(604800),
  TRUST_PROXY: z.coerce.boolean().default(false),
  REDIS_PASSWORD: z.string().optional(),
});

export const config = envSchema.parse(process.env);

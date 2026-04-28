import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import { config } from "./config.js";

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
};
if (config.REDIS_PASSWORD) {
  redisOptions.password = config.REDIS_PASSWORD;
}
export const redis = new Redis(config.REDIS_URL, redisOptions);

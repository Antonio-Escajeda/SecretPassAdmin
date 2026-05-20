import { config } from "./config.js";

export const base64urlRegex = /^[A-Za-z0-9_-]+$/;

interface ValidationIssue {
  path: string[];
  message: string;
}

interface ValidationSuccess<T> {
  success: true;
  data: T;
}

interface ValidationFailure {
  success: false;
  error: { issues: ValidationIssue[] };
}

export type CreateSecretInput = {
  ciphertext: string;
  iv: string;
  salt?: string;
  ttlSeconds: number;
};

export const createSecretSchema = {
  safeParse(input: unknown): ValidationSuccess<CreateSecretInput> | ValidationFailure {
    if (typeof input !== "object" || input === null) {
      return { success: false, error: { issues: [{ path: [], message: "Expected object" }] } };
    }

    const obj = input as Record<string, unknown>;
    const issues: ValidationIssue[] = [];
    const maxCiphertextLen = Math.ceil(config.MAX_SECRET_BYTES * (4 / 3)) + 4;

    if (
      typeof obj.ciphertext !== "string" ||
      !base64urlRegex.test(obj.ciphertext) ||
      obj.ciphertext.length > maxCiphertextLen
    ) {
      issues.push({ path: ["ciphertext"], message: "Invalid ciphertext" });
    }

    if (
      typeof obj.iv !== "string" ||
      !base64urlRegex.test(obj.iv) ||
      obj.iv.length < 16 ||
      obj.iv.length > 32
    ) {
      issues.push({ path: ["iv"], message: "Invalid iv" });
    }

    if (obj.salt !== undefined) {
      if (
        typeof obj.salt !== "string" ||
        !base64urlRegex.test(obj.salt) ||
        obj.salt.length < 16 ||
        obj.salt.length > 32
      ) {
        issues.push({ path: ["salt"], message: "Invalid salt" });
      }
    }

    if (
      typeof obj.ttlSeconds !== "number" ||
      !Number.isInteger(obj.ttlSeconds) ||
      obj.ttlSeconds < config.MIN_TTL_SECONDS ||
      obj.ttlSeconds > config.MAX_TTL_SECONDS
    ) {
      issues.push({ path: ["ttlSeconds"], message: "Invalid ttlSeconds" });
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }

    const data: CreateSecretInput = {
      ciphertext: obj.ciphertext as string,
      iv: obj.iv as string,
      ttlSeconds: obj.ttlSeconds as number,
    };
    if (typeof obj.salt === "string") {
      data.salt = obj.salt;
    }

    return { success: true, data };
  },
};

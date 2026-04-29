export function base64urlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptSecret(secret: string): Promise<{
  ciphertext: string;
  iv: string;
  key: string;
}> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(secret);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const rawKey = await crypto.subtle.exportKey("raw", key);

  return {
    ciphertext: base64urlEncode(ciphertext),
    iv: base64urlEncode(iv),
    key: base64urlEncode(rawKey),
  };
}

export async function decryptSecret(params: {
  ciphertext: string;
  iv: string;
  key: string;
}): Promise<string> {
  const rawKey = base64urlDecode(params.key);
  const iv = base64urlDecode(params.iv);
  const ciphertext = base64urlDecode(params.ciphertext);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

export async function encryptSecretWithPassphrase(
  secret: string,
  passphrase: string
): Promise<{ ciphertext: string; iv: string; key: string; salt: string }> {
  const urlKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const urlKeyB64 = base64urlEncode(urlKeyBytes);
  const passwordBytes = new TextEncoder().encode(passphrase + ":" + urlKeyB64);

  const pbkdf2Key = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 600000, hash: "SHA-256" },
    pbkdf2Key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(secret)
  );

  return {
    ciphertext: base64urlEncode(ciphertextBuffer),
    iv: base64urlEncode(iv),
    key: urlKeyB64,
    salt: base64urlEncode(saltBytes),
  };
}

export async function decryptSecretWithPassphrase(params: {
  ciphertext: string;
  iv: string;
  key: string;
  salt: string;
  passphrase: string;
}): Promise<string> {
  const saltBytes = base64urlDecode(params.salt);
  const iv = base64urlDecode(params.iv);
  const ciphertext = base64urlDecode(params.ciphertext);
  const passwordBytes = new TextEncoder().encode(params.passphrase + ":" + params.key);

  const pbkdf2Key = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 600000, hash: "SHA-256" },
    pbkdf2Key,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

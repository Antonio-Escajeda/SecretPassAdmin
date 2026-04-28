export async function createSecretOnServer(input: {
  ciphertext: string;
  iv: string;
  ttlSeconds: number;
  salt?: string;
}): Promise<{ id: string; expiresAt: string }> {
  const response = await fetch("/api/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create secret: ${response.status} ${text}`);
  }

  return response.json() as Promise<{ id: string; expiresAt: string }>;
}

export async function revealSecretFromServer(id: string): Promise<{
  version: number;
  algorithm: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  expiresAt: string;
  maxViews: number;
  salt: string | null;
  hasPassphrase: boolean;
}> {
  const response = await fetch(`/api/secrets/${id}/reveal`, {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to reveal secret: ${response.status} ${text}`);
  }

  return response.json() as Promise<{
    version: number;
    algorithm: string;
    ciphertext: string;
    iv: string;
    createdAt: string;
    expiresAt: string;
    maxViews: number;
    salt: string | null;
    hasPassphrase: boolean;
  }>;
}

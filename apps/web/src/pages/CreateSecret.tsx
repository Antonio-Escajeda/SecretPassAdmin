import { useState } from "react";
import { encryptSecret, encryptSecretWithPassphrase } from "../crypto";
import { createSecretOnServer } from "../api";

// ─── Configurable limits ────────────────────────────────────────────────────
const MAX_DAYS = 7;    // Maximum expiry: days from now
const MIN_MINUTES = 5; // Minimum expiry: minutes from now
// ────────────────────────────────────────────────────────────────────────────

// ─── Passphrase mode ─────────────────────────────────────────────────────────
// Set to true to enable passphrase protection by default, false for optional toggle
const PASSPHRASE_DEFAULT = false;
// ─────────────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 560,
    margin: "60px auto",
    padding: "0 16px",
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 24,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 6,
    color: "#333",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
    resize: "vertical",
    minHeight: 120,
    boxSizing: "border-box",
  },
  select: {
    width: "100%",
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
    boxSizing: "border-box" as const,
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
    boxSizing: "border-box" as const,
  },
  button: {
    marginTop: 16,
    width: "100%",
    padding: "10px",
    fontSize: 15,
    fontWeight: 600,
    background: "#1a1a1a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  resultBox: {
    marginTop: 24,
    padding: 16,
    background: "#f5f5f5",
    borderRadius: 8,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
    color: "#333",
  },
  resultTextarea: {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fff",
    wordBreak: "break-all",
    boxSizing: "border-box",
    resize: "none",
    minHeight: 80,
  },
  copyButton: {
    marginTop: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 6,
    cursor: "pointer",
  },
  error: {
    marginTop: 12,
    color: "#c00",
    fontSize: 13,
  },
};

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function maxDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + MAX_DAYS);
  return d.toISOString().split("T")[0];
}

type TtlMode = "duration" | "date";

export default function CreateSecret() {
  const [secret, setSecret] = useState("");
  const [ttlMode, setTtlMode] = useState<TtlMode>("duration");

  // Duration mode state
  const [durationHours, setDurationHours] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);

  // Date mode state
  const [expiryDate, setExpiryDate] = useState<string>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d.toISOString().split("T")[0];
  });
  const [expiryHour, setExpiryHour] = useState<number>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d.getHours();
  });
  const [expiryMinute, setExpiryMinute] = useState<number>(0);
  const [usePassphrase, setUsePassphrase] = useState(PASSPHRASE_DEFAULT);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function computeTtlSeconds(): number {
    if (ttlMode === "duration") {
      return durationHours * 3600 + durationMinutes * 60;
    }
    const target = new Date(expiryDate);
    target.setHours(expiryHour, expiryMinute, 0, 0);
    return Math.round((target.getTime() - Date.now()) / 1000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;

    const ttl = computeTtlSeconds();
    if (ttl < MIN_MINUTES * 60) {
      setError(`La expiración mínima es ${MIN_MINUTES} minutos.`);
      return;
    }

    if (usePassphrase) {
      if (!passphrase.trim()) {
        setError("Ingresá una contraseña de protección.");
        return;
      }
      if (passphrase !== passphraseConfirm) {
        setError("Las contraseñas no coinciden.");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setGeneratedUrl(null);

    try {
      let encrypted: { ciphertext: string; iv: string; key: string; salt?: string };

      if (usePassphrase) {
        encrypted = await encryptSecretWithPassphrase(secret, passphrase);
      } else {
        encrypted = await encryptSecret(secret);
      }

      const { id } = await createSecretOnServer({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        ttlSeconds: ttl,
        salt: encrypted.salt,
      });
      const url = `${window.location.origin}/s/${id}#${encrypted.key}`;
      setGeneratedUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text
    }
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Compartir secreto de forma segura</h1>
      <p style={styles.subtitle}>
        El contenido se cifra en tu navegador. El servidor nunca ve el texto plano.
      </p>

      <form onSubmit={handleSubmit}>
        <label style={styles.label} htmlFor="secret">
          Secreto
        </label>
        <textarea
          id="secret"
          style={styles.textarea}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Escribe aquí tu contraseña, token o mensaje secreto…"
          disabled={loading}
        />

        {/* Mode selector */}
        <div style={{ display: "flex", gap: 24, marginTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            <input type="radio" name="ttlMode" value="duration" checked={ttlMode === "duration"} onChange={() => setTtlMode("duration")} />
            Duración
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            <input type="radio" name="ttlMode" value="date" checked={ttlMode === "date"} onChange={() => setTtlMode("date")} />
            Fecha exacta
          </label>
        </div>

        {/* Duration panel */}
        <div style={{ marginTop: 12, opacity: ttlMode === "duration" ? 1 : 0.4, transition: "opacity 0.15s", pointerEvents: ttlMode === "duration" ? "auto" : "none" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={styles.label} htmlFor="durationHours">Horas</label>
              <input
                id="durationHours"
                type="number"
                min={0}
                max={167}
                style={styles.input}
                value={durationHours}
                onChange={(e) => setDurationHours(Math.max(0, Math.min(167, Number(e.target.value))))}
                disabled={ttlMode !== "duration" || loading}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label} htmlFor="durationMinutes">Minutos</label>
              <select
                id="durationMinutes"
                style={styles.select}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                disabled={ttlMode !== "duration" || loading}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Date panel */}
        <div style={{ marginTop: 12, opacity: ttlMode === "date" ? 1 : 0.4, transition: "opacity 0.15s", pointerEvents: ttlMode === "date" ? "auto" : "none" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 2 }}>
              <label style={styles.label} htmlFor="expiryDate">Fecha</label>
              <input id="expiryDate" type="date" style={styles.input} value={expiryDate} min={todayString()} max={maxDateString()} onChange={(e) => setExpiryDate(e.target.value)} disabled={ttlMode !== "date" || loading} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label} htmlFor="expiryHour">Hora</label>
              <select id="expiryHour" style={styles.select} value={expiryHour} onChange={(e) => setExpiryHour(Number(e.target.value))} disabled={ttlMode !== "date" || loading}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label} htmlFor="expiryMinute">Minuto</label>
              <select id="expiryMinute" style={styles.select} value={expiryMinute} onChange={(e) => setExpiryMinute(Number(e.target.value))} disabled={ttlMode !== "date" || loading}>
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Passphrase toggle */}
        <div style={{ marginTop: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={usePassphrase}
              onChange={(e) => {
                setUsePassphrase(e.target.checked);
                setPassphrase("");
                setPassphraseConfirm("");
              }}
              disabled={loading}
            />
            <span style={{ fontWeight: 600 }}>Proteger con contraseña</span>
            <span style={{ color: "#888", fontWeight: 400 }}> — el receptor deberá ingresarla para ver el secreto</span>
          </label>
        </div>

        {usePassphrase && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={styles.label} htmlFor="passphrase">Contraseña</label>
              <input
                id="passphrase"
                type="password"
                style={styles.input}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Contraseña que compartirás con el receptor"
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label style={styles.label} htmlFor="passphraseConfirm">Confirmar contraseña</label>
              <input
                id="passphraseConfirm"
                type="password"
                style={styles.input}
                value={passphraseConfirm}
                onChange={(e) => setPassphraseConfirm(e.target.value)}
                placeholder="Repetí la contraseña"
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
            <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
              Compartí esta contraseña con el receptor por un canal distinto al enlace (teléfono, en persona, etc).
            </p>
          </div>
        )}

        <button
          type="submit"
          style={{
            ...styles.button,
            ...(loading || !secret.trim() ? styles.buttonDisabled : {}),
          }}
          disabled={loading || !secret.trim()}
        >
          {loading ? "Cifrando…" : "Crear enlace seguro"}
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      {generatedUrl && (
        <div style={styles.resultBox}>
          <p style={styles.resultLabel}>Enlace generado (úsalo una sola vez)</p>
          <textarea
            readOnly
            style={styles.resultTextarea}
            value={generatedUrl}
            rows={3}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <button style={styles.copyButton} onClick={handleCopy}>
            {copied ? "Copiado!" : "Copiar enlace"}
          </button>
        </div>
      )}
    </div>
  );
}

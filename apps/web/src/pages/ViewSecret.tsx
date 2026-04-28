import { useRef, useState } from "react";
import { decryptSecret, decryptSecretWithPassphrase } from "../crypto";
import { revealSecretFromServer } from "../api";

type Phase = "pending" | "passphrase" | "loading" | "ready" | "error";

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 520,
    margin: "60px auto",
    padding: "0 16px",
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8,
  },
  warning: {
    fontSize: 14,
    color: "#7a4800",
    background: "#fff4e0",
    border: "1px solid #f5c542",
    borderRadius: 6,
    padding: "10px 14px",
    marginBottom: 24,
  },
  button: {
    padding: "10px 20px",
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
    background: "#f9f9f9",
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
  note: {
    marginTop: 12,
    fontSize: 13,
    color: "#555",
    fontStyle: "italic",
  },
  error: {
    marginTop: 12,
    color: "#c00",
    fontSize: 14,
  },
};

export default function ViewSecret() {
  // Extract key from fragment ONCE on mount, before history.replaceState removes it.
  const keyRef = useRef<string>("");
  const idRef = useRef<string>(window.location.pathname.replace(/^\/s\//, ""));
  const encryptedRef = useRef<{
    ciphertext: string;
    iv: string;
    salt: string | null;
    hasPassphrase: boolean;
  } | null>(null);

  const [phase, setPhase] = useState<Phase>("pending");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");

  async function handleReveal() {
    keyRef.current = window.location.hash.slice(1);
    const fragmentKey = keyRef.current;
    const id = idRef.current;

    // Remove fragment from URL bar so the key isn't visible or accidentally shared.
    window.history.replaceState(null, "", window.location.pathname);

    if (!fragmentKey) {
      setErrorMsg(
        "No se encontró la clave de descifrado en la URL. Asegurate de usar el enlace completo."
      );
      setPhase("error");
      return;
    }

    if (!id) {
      setErrorMsg("URL inválida: falta el identificador del secreto.");
      setPhase("error");
      return;
    }

    setPhase("loading");

    try {
      const data = await revealSecretFromServer(id);

      if (data.hasPassphrase) {
        encryptedRef.current = {
          ciphertext: data.ciphertext,
          iv: data.iv,
          salt: data.salt,
          hasPassphrase: data.hasPassphrase,
        };
        setPhase("passphrase");
      } else {
        const text = await decryptSecret({
          ciphertext: data.ciphertext,
          iv: data.iv,
          key: fragmentKey,
        });
        setPlaintext(text);
        setPhase("ready");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Error al revelar el secreto. Puede que ya haya sido consumido o haya expirado."
      );
      setPhase("error");
    }
  }

  async function handlePassphraseSubmit() {
    if (!encryptedRef.current || !keyRef.current) return;
    try {
      setError("");
      const plaintext = await decryptSecretWithPassphrase({
        ciphertext: encryptedRef.current.ciphertext,
        iv: encryptedRef.current.iv,
        salt: encryptedRef.current.salt!,
        key: keyRef.current,
        passphrase,
      });
      setPlaintext(plaintext);
      setPhase("ready");
    } catch {
      setError("Contraseña incorrecta o secreto corrupto.");
    }
  }

  async function handleCopy() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: user can select manually
    }
  }

  if (phase === "passphrase") {
    return (
      <main style={{ maxWidth: 560, margin: "60px auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Ingresá la contraseña</h1>
        <p style={{ color: "#555", fontSize: 14 }}>
          Este secreto está protegido con contraseña. El creador debería habértela compartido por otro canal.
        </p>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Contraseña"
          autoFocus
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6, boxSizing: "border-box" as const, marginTop: 8 }}
          onKeyDown={(e) => { if (e.key === "Enter") handlePassphraseSubmit(); }}
        />
        {error && <p style={{ color: "#c00", fontSize: 13, marginTop: 8 }}>{error}</p>}
        <button
          onClick={handlePassphraseSubmit}
          disabled={!passphrase.trim()}
          style={{ marginTop: 12, padding: "10px 20px", fontWeight: 600, fontSize: 14, background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          Descifrar
        </button>
      </main>
    );
  }

  return (
    <div style={styles.container}>
      {(phase === "pending" || phase === "loading") && (
        <>
          <h1 style={styles.heading}>Secreto recibido</h1>
          <div style={styles.warning}>
            <strong>Atención:</strong> Este secreto se destruirá al revelarlo.
            Solo podrá verse una vez.
          </div>
          <button
            style={{
              ...styles.button,
              ...(phase === "loading" ? styles.buttonDisabled : {}),
            }}
            onClick={handleReveal}
            disabled={phase === "loading"}
          >
            {phase === "loading" ? "Revelando…" : "Revelar secreto"}
          </button>
        </>
      )}

      {phase === "ready" && plaintext !== null && (
        <>
          <h1 style={styles.heading}>Secreto revelado</h1>
          <label style={styles.label} htmlFor="plaintext">
            Contenido
          </label>
          <textarea
            id="plaintext"
            readOnly
            style={styles.textarea}
            value={plaintext}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <button style={styles.copyButton} onClick={handleCopy}>
            {copied ? "Copiado!" : "Copiar secreto"}
          </button>
          <p style={styles.note}>El secreto ya fue destruido del servidor.</p>
        </>
      )}

      {phase === "error" && (
        <>
          <h1 style={styles.heading}>Error</h1>
          <p style={styles.error}>{errorMsg}</p>
        </>
      )}
    </div>
  );
}

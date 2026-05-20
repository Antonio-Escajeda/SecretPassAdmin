import { decryptSecret, decryptSecretWithPassphrase } from "../crypto.js";
import { revealSecretFromServer } from "../api.js";

type Phase = "pending" | "passphrase" | "loading" | "ready" | "error";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]>,
  styles?: Partial<CSSStyleDeclaration>
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props) Object.assign(element, props);
  if (styles) {
    for (const [k, v] of Object.entries(styles)) {
      if (typeof v === "string") (element.style as unknown as Record<string, string>)[k] = v;
    }
  }
  return element;
}

export function createViewSecretPage(): HTMLElement {
  let fragmentKey = "";
  const secretId = window.location.pathname.replace(/^\/s\//, "");
  let encryptedData: { ciphertext: string; iv: string; salt: string | null } | null = null;

  const container = el("div", {}, {
    fontFamily: "system-ui, sans-serif",
    maxWidth: "520px",
    margin: "60px auto",
    padding: "0 16px",
  });

  // ─── Pending / Loading ────────────────────────────────────────────────────
  const pendingSection = el("div");
  pendingSection.appendChild(el("h1", { textContent: "Secreto recibido" }, {
    fontSize: "22px", fontWeight: "700", marginBottom: "8px",
  }));

  const warningDiv = el("div", {}, {
    fontSize: "14px", color: "#7a4800",
    background: "#fff4e0", border: "1px solid #f5c542",
    borderRadius: "6px", padding: "10px 14px", marginBottom: "24px",
  });
  warningDiv.appendChild(el("strong", { textContent: "Atención:" }));
  warningDiv.appendChild(document.createTextNode(" Este secreto se destruirá al revelarlo. Solo podrá verse una vez."));
  pendingSection.appendChild(warningDiv);

  const revealBtn = el("button", { textContent: "Revelar secreto" }, {
    padding: "10px 20px", fontSize: "15px", fontWeight: "600",
    background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer",
  });
  pendingSection.appendChild(revealBtn);
  container.appendChild(pendingSection);

  // ─── Passphrase ───────────────────────────────────────────────────────────
  const passphraseSection = el("div", {}, { display: "none" });
  passphraseSection.appendChild(el("h1", { textContent: "Ingresá la contraseña" }, {
    fontSize: "22px", fontWeight: "700",
  }));
  passphraseSection.appendChild(el("p", {
    textContent: "Este secreto está protegido con contraseña. El creador debería habértela compartido por otro canal.",
  }, { color: "#555", fontSize: "14px" }));

  const passphraseInput = el("input", { type: "password", placeholder: "Contraseña" }, {
    width: "100%", padding: "10px 12px", fontSize: "14px",
    border: "1px solid #ccc", borderRadius: "6px", boxSizing: "border-box", marginTop: "8px",
  });

  const passphraseErrorP = el("p", {}, { color: "#c00", fontSize: "13px", marginTop: "8px", display: "none" });

  const decryptBtn = el("button", { textContent: "Descifrar", disabled: true }, {
    marginTop: "12px", padding: "10px 20px", fontWeight: "600", fontSize: "14px",
    background: "#1a1a1a", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer",
  });

  passphraseInput.addEventListener("input", () => {
    decryptBtn.disabled = !passphraseInput.value.trim();
  });

  passphraseSection.appendChild(passphraseInput);
  passphraseSection.appendChild(passphraseErrorP);
  passphraseSection.appendChild(decryptBtn);
  container.appendChild(passphraseSection);

  // ─── Ready ────────────────────────────────────────────────────────────────
  const readySection = el("div", {}, { display: "none" });
  readySection.appendChild(el("h1", { textContent: "Secreto revelado" }, {
    fontSize: "22px", fontWeight: "700", marginBottom: "8px",
  }));
  readySection.appendChild(el("label", { htmlFor: "plaintext", textContent: "Contenido" }, {
    display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px", color: "#333",
  }));

  const plaintextArea = el("textarea", { id: "plaintext", readOnly: true }, {
    width: "100%", padding: "10px 12px", fontSize: "14px",
    border: "1px solid #ccc", borderRadius: "6px",
    resize: "vertical", minHeight: "120px", boxSizing: "border-box", background: "#f9f9f9",
  });
  plaintextArea.addEventListener("click", () => plaintextArea.select());

  const copyBtn = el("button", { type: "button", textContent: "Copiar secreto" }, {
    marginTop: "10px", padding: "8px 14px", fontSize: "13px", fontWeight: "600",
    background: "#fff", border: "1px solid #ccc", borderRadius: "6px", cursor: "pointer",
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(plaintextArea.value);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => { copyBtn.textContent = "Copiar secreto"; }, 2000);
    } catch { /* fallback */ }
  });

  readySection.appendChild(plaintextArea);
  readySection.appendChild(copyBtn);
  readySection.appendChild(el("p", { textContent: "El secreto ya fue destruido del servidor." }, {
    marginTop: "12px", fontSize: "13px", color: "#555", fontStyle: "italic",
  }));
  container.appendChild(readySection);

  // ─── Error ────────────────────────────────────────────────────────────────
  const errorSection = el("div", {}, { display: "none" });
  errorSection.appendChild(el("h1", { textContent: "Error" }, {
    fontSize: "22px", fontWeight: "700", marginBottom: "8px",
  }));
  const errorMsgP = el("p", {}, { marginTop: "12px", color: "#c00", fontSize: "14px" });
  errorSection.appendChild(errorMsgP);
  container.appendChild(errorSection);

  // ─── Phase management ─────────────────────────────────────────────────────
  function setPhase(p: Phase): void {
    pendingSection.style.display = (p === "pending" || p === "loading") ? "block" : "none";
    passphraseSection.style.display = p === "passphrase" ? "block" : "none";
    readySection.style.display = p === "ready" ? "block" : "none";
    errorSection.style.display = p === "error" ? "block" : "none";

    if (p === "loading") {
      revealBtn.disabled = true;
      revealBtn.textContent = "Revelando…";
      revealBtn.style.opacity = "0.5";
      revealBtn.style.cursor = "not-allowed";
    }
  }

  // ─── Reveal ───────────────────────────────────────────────────────────────
  revealBtn.addEventListener("click", async () => {
    fragmentKey = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);

    if (!fragmentKey) {
      errorMsgP.textContent = "No se encontró la clave de descifrado en la URL. Asegurate de usar el enlace completo.";
      setPhase("error");
      return;
    }
    if (!secretId) {
      errorMsgP.textContent = "URL inválida: falta el identificador del secreto.";
      setPhase("error");
      return;
    }

    setPhase("loading");

    try {
      const data = await revealSecretFromServer(secretId);

      if (data.hasPassphrase) {
        encryptedData = { ciphertext: data.ciphertext, iv: data.iv, salt: data.salt };
        setPhase("passphrase");
      } else {
        plaintextArea.value = await decryptSecret({ ciphertext: data.ciphertext, iv: data.iv, key: fragmentKey });
        setPhase("ready");
      }
    } catch (err) {
      errorMsgP.textContent = err instanceof Error
        ? err.message
        : "Error al revelar el secreto. Puede que ya haya sido consumido o haya expirado.";
      setPhase("error");
    }
  });

  // ─── Passphrase submit ────────────────────────────────────────────────────
  async function handlePassphraseSubmit(): Promise<void> {
    if (!encryptedData || !fragmentKey) return;
    passphraseErrorP.style.display = "none";
    try {
      plaintextArea.value = await decryptSecretWithPassphrase({
        ciphertext: encryptedData.ciphertext,
        iv: encryptedData.iv,
        salt: encryptedData.salt ?? "",
        key: fragmentKey,
        passphrase: passphraseInput.value,
      });
      setPhase("ready");
    } catch {
      passphraseErrorP.textContent = "Contraseña incorrecta o secreto corrupto.";
      passphraseErrorP.style.display = "block";
    }
  }

  decryptBtn.addEventListener("click", () => void handlePassphraseSubmit());
  passphraseInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void handlePassphraseSubmit(); });

  return container;
}

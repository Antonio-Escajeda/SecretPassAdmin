import { encryptSecret, encryptSecretWithArgon2id } from "../crypto.js";
import { createSecretOnServer } from "../api.js";

const MAX_DAYS = 7;
const MIN_MINUTES = 5;
const PASSPHRASE_DEFAULT = false;

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

function todayString(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

function maxDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + MAX_DAYS);
  return d.toISOString().split("T")[0] ?? "";
}

const labelStyle: Partial<CSSStyleDeclaration> = {
  display: "block",
  fontSize: "13px",
  fontWeight: "600",
  marginBottom: "6px",
  color: "#333",
};
const inputStyle: Partial<CSSStyleDeclaration> = {
  width: "100%",
  padding: "8px 12px",
  fontSize: "14px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  boxSizing: "border-box",
};

export function createCreateSecretPage(): HTMLElement {
  // ─── State ────────────────────────────────────────────────────────────────
  let ttlMode: "duration" | "date" = "duration";
  let durationHours = 1;
  let durationMinutes = 0;
  let usePassphrase = PASSPHRASE_DEFAULT;
  let loading = false;

  // ─── Container ────────────────────────────────────────────────────────────
  const container = el("div", {}, {
    fontFamily: "system-ui, sans-serif",
    maxWidth: "560px",
    margin: "60px auto",
    padding: "0 16px",
  });

  container.appendChild(el("h1", { textContent: "Compartir secreto de forma segura" }, {
    fontSize: "22px",
    fontWeight: "700",
    marginBottom: "8px",
  }));
  container.appendChild(el("p", {
    textContent: "El contenido se cifra en tu navegador. El servidor nunca ve el texto plano.",
  }, { fontSize: "14px", color: "#666", marginBottom: "24px" }));

  // ─── Form ─────────────────────────────────────────────────────────────────
  const form = el("form");
  container.appendChild(form);

  form.appendChild(el("label", { htmlFor: "secret", textContent: "Secreto" }, labelStyle));

  const secretTextarea = el("textarea", {
    id: "secret",
    placeholder: "Escribe aquí tu contraseña, token o mensaje secreto…",
  }, {
    width: "100%",
    padding: "10px 12px",
    fontSize: "14px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    resize: "vertical",
    minHeight: "120px",
    boxSizing: "border-box",
  });
  form.appendChild(secretTextarea);

  // ─── TTL mode radios ──────────────────────────────────────────────────────
  const modeRow = el("div", {}, { display: "flex", gap: "24px", marginTop: "16px" });
  form.appendChild(modeRow);

  function makeRadio(value: "duration" | "date", labelText: string): HTMLLabelElement {
    const lbl = el("label", {}, {
      display: "flex", alignItems: "center", gap: "6px",
      cursor: "pointer", fontSize: "14px", fontWeight: "600",
    });
    const radio = el("input", { type: "radio", name: "ttlMode", value, checked: value === "duration" });
    radio.addEventListener("change", () => { ttlMode = value; syncPanels(); });
    lbl.appendChild(radio);
    lbl.appendChild(document.createTextNode(labelText));
    return lbl;
  }
  modeRow.appendChild(makeRadio("duration", "Duración"));
  modeRow.appendChild(makeRadio("date", "Fecha exacta"));

  // ─── Duration panel ───────────────────────────────────────────────────────
  const durationPanel = el("div", {}, { marginTop: "12px" });
  const durationRow = el("div", {}, { display: "flex", gap: "8px" });
  durationPanel.appendChild(durationRow);

  const hoursDiv = el("div", {}, { flex: "1" });
  hoursDiv.appendChild(el("label", { htmlFor: "durationHours", textContent: "Horas" }, labelStyle));
  const hoursInput = el("input", { id: "durationHours", type: "number", value: "1" }, inputStyle);
  hoursInput.setAttribute("min", "0");
  hoursInput.setAttribute("max", "167");
  hoursInput.addEventListener("input", () => {
    durationHours = Math.max(0, Math.min(167, Number(hoursInput.value)));
  });
  hoursDiv.appendChild(hoursInput);
  durationRow.appendChild(hoursDiv);

  const minutesDiv = el("div", {}, { flex: "1" });
  minutesDiv.appendChild(el("label", { htmlFor: "durationMinutes", textContent: "Minutos" }, labelStyle));
  const minutesSelect = el("select", { id: "durationMinutes" }, inputStyle);
  [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach((m) => {
    minutesSelect.appendChild(el("option", { value: String(m), textContent: String(m).padStart(2, "0") }));
  });
  minutesSelect.addEventListener("change", () => { durationMinutes = Number(minutesSelect.value); });
  minutesDiv.appendChild(minutesSelect);
  durationRow.appendChild(minutesDiv);
  form.appendChild(durationPanel);

  // ─── Date panel ───────────────────────────────────────────────────────────
  const d0 = new Date();
  d0.setHours(d0.getHours() + 1);
  const initDate = d0.toISOString().split("T")[0] ?? "";
  const initHour = d0.getHours();

  const datePanel = el("div", {}, { marginTop: "12px", opacity: "0.4", pointerEvents: "none" });
  const dateRow = el("div", {}, { display: "flex", gap: "8px", alignItems: "flex-end" });
  datePanel.appendChild(dateRow);

  const dateDiv = el("div", {}, { flex: "2" });
  dateDiv.appendChild(el("label", { htmlFor: "expiryDate", textContent: "Fecha" }, labelStyle));
  const dateInput = el("input", { id: "expiryDate", type: "date", value: initDate }, inputStyle);
  dateInput.setAttribute("min", todayString());
  dateInput.setAttribute("max", maxDateString());
  dateDiv.appendChild(dateInput);
  dateRow.appendChild(dateDiv);

  const hourDiv = el("div", {}, { flex: "1" });
  hourDiv.appendChild(el("label", { htmlFor: "expiryHour", textContent: "Hora" }, labelStyle));
  const hourSelect = el("select", { id: "expiryHour" }, inputStyle);
  Array.from({ length: 24 }, (_, i) => {
    const opt = el("option", { value: String(i), textContent: String(i).padStart(2, "0") + ":00" });
    if (i === initHour) opt.selected = true;
    hourSelect.appendChild(opt);
  });
  hourDiv.appendChild(hourSelect);
  dateRow.appendChild(hourDiv);

  const minuteDiv = el("div", {}, { flex: "1" });
  minuteDiv.appendChild(el("label", { htmlFor: "expiryMinute", textContent: "Minuto" }, labelStyle));
  const minuteSelect = el("select", { id: "expiryMinute" }, inputStyle);
  [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach((m) => {
    minuteSelect.appendChild(el("option", { value: String(m), textContent: String(m).padStart(2, "0") }));
  });
  minuteDiv.appendChild(minuteSelect);
  dateRow.appendChild(minuteDiv);
  form.appendChild(datePanel);

  function syncPanels(): void {
    const isDuration = ttlMode === "duration";
    durationPanel.style.opacity = isDuration ? "1" : "0.4";
    durationPanel.style.pointerEvents = isDuration ? "auto" : "none";
    datePanel.style.opacity = isDuration ? "0.4" : "1";
    datePanel.style.pointerEvents = isDuration ? "none" : "auto";
    hoursInput.disabled = !isDuration || loading;
    minutesSelect.disabled = !isDuration || loading;
    dateInput.disabled = isDuration || loading;
    hourSelect.disabled = isDuration || loading;
    minuteSelect.disabled = isDuration || loading;
  }

  // ─── Passphrase toggle ────────────────────────────────────────────────────
  const passphraseToggleDiv = el("div", {}, { marginTop: "20px" });
  const passphraseToggleLabel = el("label", {}, {
    display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px",
  });
  const passphraseCheckbox = el("input", { type: "checkbox", checked: PASSPHRASE_DEFAULT });
  const boldSpan = el("span", { textContent: "Proteger con contraseña" }, { fontWeight: "600" });
  const subtitleSpan = el("span", {
    textContent: " — el receptor deberá ingresarla para ver el secreto",
  }, { color: "#888" });
  passphraseToggleLabel.appendChild(passphraseCheckbox);
  passphraseToggleLabel.appendChild(boldSpan);
  passphraseToggleLabel.appendChild(subtitleSpan);
  passphraseToggleDiv.appendChild(passphraseToggleLabel);
  form.appendChild(passphraseToggleDiv);

  // ─── Passphrase fields ────────────────────────────────────────────────────
  const passphraseSection = el("div", {}, { marginTop: "12px", display: "none", flexDirection: "column", gap: "10px" });

  const passphraseInput = el("input", {
    id: "passphrase", type: "password",
    placeholder: "Contraseña que compartirás con el receptor",
    autocomplete: "new-password",
  }, inputStyle);

  const passphraseConfirmInput = el("input", {
    id: "passphraseConfirm", type: "password",
    placeholder: "Repetí la contraseña",
    autocomplete: "new-password",
  }, inputStyle);

  const ppDiv1 = el("div");
  ppDiv1.appendChild(el("label", { htmlFor: "passphrase", textContent: "Contraseña" }, labelStyle));
  ppDiv1.appendChild(passphraseInput);

  const ppDiv2 = el("div");
  ppDiv2.appendChild(el("label", { htmlFor: "passphraseConfirm", textContent: "Confirmar contraseña" }, labelStyle));
  ppDiv2.appendChild(passphraseConfirmInput);

  passphraseSection.appendChild(ppDiv1);
  passphraseSection.appendChild(ppDiv2);
  passphraseSection.appendChild(el("p", {
    textContent: "Compartí esta contraseña con el receptor por un canal distinto al enlace (teléfono, en persona, etc).",
  }, { fontSize: "12px", color: "#888", margin: "0" }));
  form.appendChild(passphraseSection);

  passphraseCheckbox.addEventListener("change", () => {
    usePassphrase = passphraseCheckbox.checked;
    passphraseSection.style.display = usePassphrase ? "flex" : "none";
    passphraseInput.value = "";
    passphraseConfirmInput.value = "";
  });

  // ─── Submit button ────────────────────────────────────────────────────────
  const submitBtn = el("button", { type: "submit", textContent: "Crear enlace seguro" }, {
    marginTop: "16px", width: "100%", padding: "10px",
    fontSize: "15px", fontWeight: "600",
    background: "#1a1a1a", color: "#fff",
    border: "none", borderRadius: "6px",
    cursor: "pointer", opacity: "0.5",
  });
  submitBtn.disabled = true;
  form.appendChild(submitBtn);

  const errorP = el("p", {}, { marginTop: "12px", color: "#c00", fontSize: "13px", display: "none" });
  container.appendChild(errorP);

  // ─── Result box ───────────────────────────────────────────────────────────
  const resultBox = el("div", {}, {
    marginTop: "24px", padding: "16px", background: "#f5f5f5", borderRadius: "8px", display: "none",
  });
  resultBox.appendChild(el("p", { textContent: "Enlace generado (úsalo una sola vez)" }, {
    fontSize: "13px", fontWeight: "600", marginBottom: "8px", color: "#333",
  }));
  const resultTextarea = el("textarea", { readOnly: true, rows: 3 }, {
    width: "100%", padding: "8px 10px", fontSize: "13px",
    border: "1px solid #ccc", borderRadius: "6px",
    background: "#fff", wordBreak: "break-all",
    boxSizing: "border-box", resize: "none", minHeight: "80px",
  });
  resultTextarea.addEventListener("click", () => resultTextarea.select());
  const copyBtn = el("button", { type: "button", textContent: "Copiar enlace" }, {
    marginTop: "10px", padding: "8px 14px", fontSize: "13px", fontWeight: "600",
    background: "#fff", border: "1px solid #ccc", borderRadius: "6px", cursor: "pointer",
  });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resultTextarea.value);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => { copyBtn.textContent = "Copiar enlace"; }, 2000);
    } catch { /* fallback */ }
  });
  resultBox.appendChild(resultTextarea);
  resultBox.appendChild(copyBtn);
  container.appendChild(resultBox);

  // ─── State helpers ────────────────────────────────────────────────────────
  function setLoading(val: boolean): void {
    loading = val;
    const empty = !secretTextarea.value.trim();
    submitBtn.disabled = val || empty;
    submitBtn.style.opacity = val || empty ? "0.5" : "1";
    submitBtn.style.cursor = val || empty ? "not-allowed" : "pointer";
    submitBtn.textContent = val ? "Cifrando…" : "Crear enlace seguro";
    secretTextarea.disabled = val;
    passphraseCheckbox.disabled = val;
    passphraseInput.disabled = val;
    passphraseConfirmInput.disabled = val;
    syncPanels();
  }

  function setError(msg: string | null): void {
    errorP.textContent = msg ?? "";
    errorP.style.display = msg ? "block" : "none";
  }

  secretTextarea.addEventListener("input", () => {
    const empty = !secretTextarea.value.trim();
    submitBtn.disabled = loading || empty;
    submitBtn.style.opacity = loading || empty ? "0.5" : "1";
    submitBtn.style.cursor = loading || empty ? "not-allowed" : "pointer";
  });

  // ─── Submit ───────────────────────────────────────────────────────────────
  function computeTtlSeconds(): number {
    if (ttlMode === "duration") return durationHours * 3600 + durationMinutes * 60;
    const target = new Date(dateInput.value);
    target.setHours(Number(hourSelect.value), Number(minuteSelect.value), 0, 0);
    return Math.round((target.getTime() - Date.now()) / 1000);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!secretTextarea.value.trim()) return;

    const ttl = computeTtlSeconds();
    if (ttl < MIN_MINUTES * 60) {
      setError(`La expiración mínima es ${MIN_MINUTES} minutos.`);
      return;
    }

    if (usePassphrase) {
      if (!passphraseInput.value.trim()) { setError("Ingresá una contraseña de protección."); return; }
      if (passphraseInput.value !== passphraseConfirmInput.value) { setError("Las contraseñas no coinciden."); return; }
    }

    setLoading(true);
    setError(null);
    resultBox.style.display = "none";

    try {
      let encrypted: { ciphertext: string; iv: string; key: string; salt?: string };
      if (usePassphrase) {
        encrypted = await encryptSecretWithArgon2id(secretTextarea.value, passphraseInput.value);
      } else {
        encrypted = await encryptSecret(secretTextarea.value);
      }

      const { id } = await createSecretOnServer({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        ttlSeconds: ttl,
        salt: encrypted.salt,
      });

      resultTextarea.value = `${window.location.origin}/s/${id}#${encrypted.key}`;
      resultBox.style.display = "block";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  });

  return container;
}

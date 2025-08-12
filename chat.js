// =============== CONFIG ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Prompt del sistema (mejorado)
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Habla SIEMPRE en español, con claridad y estructura.

Estilo de respuesta:
- Primero una idea general en 1–2 frases.
- Luego usa listas o pasos cuando ayuden.
- Fórmulas en LaTeX usando $$ ... $$ para que salgan GRANDES.
- Incluye símbolos y unidades cuando aplique (ej.: m/s, °C, N, J).
- Si corresponde, muestra 1 ejemplo resuelto y, si hay código, usa bloques triple backticks.

Cuando el usuario pida “la fórmula”, escribe así:
1) Explicación corta.
2) $$ \\text{Fórmula } \\quad v_m = \\dfrac{\\Delta x}{\\Delta t} $$
3) Define las variables con línea separada (sin LaTeX).
`;

// ============ AVATAR ANIMACIÓN ============
// Referencia al <svg> interno del <object id="avatar-mira">
let __innerAvatarSvg = null;
function hookAvatarInnerSvg() {
  const obj = document.getElementById("avatar-mira");
  if (!obj) return;
  const connect = () => {
    try { __innerAvatarSvg = obj.contentDocument?.documentElement || null; }
    catch { __innerAvatarSvg = null; }
  };
  if (obj.contentDocument) connect();
  obj.addEventListener("load", connect);
}
function setAvatarTalking(isTalking) {
  const avatar = document.getElementById("avatar-mira");
  if (!avatar) return;
  avatar.classList.toggle("pulse", !!isTalking);
  avatar.classList.toggle("still", !isTalking);
  if (__innerAvatarSvg) {
    __innerAvatarSvg.classList.toggle("talking", !!isTalking);
    __innerAvatarSvg.style.setProperty("--level", isTalking ? "0.9" : "0.3");
  }
}

// ============ UI HELPERS ===============
function appendHTML(html) {
  const chatBox = document.getElementById("chat-box");
  chatBox.insertAdjacentHTML("beforeend", html);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMessage(role, contentHTML) {
  // role: "user" | "assistant"
  appendHTML(`<div class="msg ${role}"><div class="bubble chat-markdown">${contentHTML}</div></div>`);
}

function showThinking() {
  const chatBox = document.getElementById("chat-box");
  if (document.getElementById("thinking")) return;
  const thinking = document.createElement("div");
  thinking.id = "thinking";
  thinking.className = "msg assistant";
  thinking.innerHTML = `<div class="bubble">MIRA está pensando…</div>`;
  chatBox.appendChild(thinking);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function hideThinking() {
  document.getElementById("thinking")?.remove();
}

// ============ TTS (voz) ===================
function plainTextForVoice(markdown) {
  let text = markdown
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " ");
  text = text.replace(/\$[^$]*\$/g, " ");
  text = text.replace(/`{3}[\s\S]*?`{3}/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
function speak(markdown) {
  try {
    const plain = plainTextForVoice(markdown);
    if (!plain) return;
    const msg = new SpeechSynthesisUtterance(plain);
    msg.lang = "es-ES";
    window.speechSynthesis.cancel();
    setAvatarTalking(true);
    msg.onend = () => setAvatarTalking(false);
    msg.onerror = () => setAvatarTalking(false);
    window.speechSynthesis.speak(msg);
  } catch {
    setAvatarTalking(false);
  }
}

// ============ RENDER ======================
function renderMarkdown(text) {
  return typeof marked !== "undefined" ? marked.parse(text) : text;
}

// ============ WIKIPEDIA FALLBACK ==========
async function wikiFallback(query) {
  try {
    const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.extract || null;
  } catch {
    return null;
  }
}

// ============ ENVÍO MENSAJE ===============
async function sendMessage() {
  const input = document.getElementById("user-input");
  const userMessage = (input.value || "").trim();
  if (!userMessage) return;

  appendMessage("user", renderMarkdown(userMessage));
  input.value = "";
  showThinking();

  try {
    // Proxy serverless en Netlify (la key vive en GROQ_API_KEY)
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.7
      })
    });

    const raw = await response.text();
    hideThinking();

    if (!response.ok) {
      let msg = "Error al conectar con la IA.";
      if (response.status === 401) msg += " (401: clave inválida o expirada)";
      else if (response.status === 403) msg += " (403: CORS o acceso denegado)";
      else if (response.status === 429) msg += " (429: límite de uso alcanzado)";
      else msg += ` (HTTP ${response.status})`;
      appendMessage("assistant", msg);
      setAvatarTalking(false);
      return;
    }

    const data = JSON.parse(raw);
    let aiReply = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!aiReply) {
      aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";
    }

    const html = renderMarkdown(aiReply);
    appendMessage("assistant", html);
    speak(aiReply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();

  } catch (err) {
    hideThinking();
    appendMessage("assistant", "Error de red o CORS al conectar con la IA.");
    setAvatarTalking(false);
    console.error("Network/JS error:", err);
  }
}

// ============ INICIO ======================
function initChat() {
  hookAvatarInnerSvg();

  const input = document.getElementById("user-input");
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
  });
  document.getElementById("send-btn")?.addEventListener("click", sendMessage);

  // Saludo como burbuja (y voz)
  const saludo = "¡Hola! Soy MIRA 👋 ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  speak(saludo);
  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();

  setAvatarTalking(false);
}
window.addEventListener("DOMContentLoaded", initChat);

// =============== CONFIG ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Prompt del sistema (mejorado)
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Habla SIEMPRE en español, con claridad y estructura.

Estilo de respuesta:
- Primero una idea general en 1–2 frases.
- Luego usa listas o pasos cuando ayuden.
- Fórmulas EN GRANDE con LaTeX usando $$ ... $$.
- Usa símbolos y unidades cuando aplique (m/s, °C, N, J).
- Si corresponde, muestra 1 ejemplo resuelto y/o bloque de código con triple backticks.

Cuando el usuario pida “la fórmula”, devuelve:
1) Explicación corta.
2) $$ \\text{Fórmula } \\quad v_m = \\dfrac{\\Delta x}{\\Delta t} $$
3) Define variables en texto (sin LaTeX).
`;

// ============ AVATAR ANIMACIÓN ============
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

// ============ TTS ROBUSTO (cola + chunking) ============
// Limpia markdown/LaTeX/código para voz
function plainTextForVoice(markdown) {
  let text = (markdown || "")
    .replace(/```[\s\S]*?```/g, " ")   // bloques de código
    .replace(/`[^`]*`/g, " ")          // inline code
    .replace(/\$\$[\s\S]*?\$\$/g, " ") // LaTeX block
    .replace(/\$[^$]*\$/g, " ")        // LaTeX inline
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/[•\-] /g, " ")
    .replace(/\n+/g, ". ");
  return text.replace(/\s+/g, " ").trim();
}

// Cola de reproducción
const VOICE_PREFS = ["es-CL", "es-ES", "es-MX", "es-419", "es"];
let voicesCache = [];
let speaking = false;
const speechQueue = [];

function refreshVoices() {
  voicesCache = window.speechSynthesis.getVoices() || [];
}
function pickVoice() {
  refreshVoices();
  const v = voicesCache.find(v => VOICE_PREFS.some(tag => (v.lang || "").toLowerCase().startsWith(tag.toLowerCase())));
  return v || voicesCache.find(v => (v.lang || "").toLowerCase().startsWith("es")) || voicesCache[0] || null;
}
window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

function splitIntoChunks(text, maxLen = 240) {
  const parts = text.split(/(?<=[\.\!\?\:\;])\s+|\n+/g);
  const chunks = [];
  let buf = "";
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if ((buf + " " + s).trim().length <= maxLen) {
      buf = (buf ? buf + " " : "") + s;
    } else {
      if (buf) chunks.push(buf);
      if (s.length <= maxLen) chunks.push(s);
      else {
        for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen));
      }
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function playNext() {
  const next = speechQueue.shift();
  if (!next) { speaking = false; setAvatarTalking(false); return; }

  const utter = new SpeechSynthesisUtterance(next);
  const v = pickVoice();
  if (v) utter.voice = v;
  utter.lang = (v && v.lang) || "es-ES";
  utter.rate = 0.98; // un pelín más lento para claridad
  utter.pitch = 1.02;
  utter.volume = 1;

  setAvatarTalking(true);
  utter.onend = () => playNext();
  utter.onerror = () => playNext();

  window.speechSynthesis.speak(utter);
  speaking = true;
}
function enqueueSpeak(text) {
  if (!text) return;
  speechQueue.push(text);
  if (!speaking) playNext();
}
function cancelAllSpeech() {
  try { window.speechSynthesis.cancel(); } catch {}
  speechQueue.length = 0;
  speaking = false;
  setAvatarTalking(false);
}
function speakMarkdown(md) {
  const plain = plainTextForVoice(md);
  if (!plain) return;
  const chunks = splitIntoChunks(plain, 240);
  chunks.forEach(c => enqueueSpeak(c));
}
function speakAfterVoices(md) {
  if (window.speechSynthesis.getVoices().length) speakMarkdown(md);
  else {
    const once = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", once);
      speakMarkdown(md);
    };
    window.speechSynthesis.addEventListener("voiceschanged", once);
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

  // Si el usuario comienza otra consulta, paramos lo anterior para no pisar audio
  cancelAllSpeech();

  appendMessage("user", renderMarkdown(userMessage));
  input.value = "";
  showThinking();

  try {
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
      return;
    }

    const data = JSON.parse(raw);
    let aiReply = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!aiReply) aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";

    const html = renderMarkdown(aiReply);
    appendMessage("assistant", html);

    // 🔊 Hablar TODA la respuesta (en cola, por bloques)
    speakMarkdown(aiReply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();

  } catch (err) {
    hideThinking();
    appendMessage("assistant", "Error de red o CORS al conectar con la IA.");
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

  // Saludo inicial UNA sola vez y hablado
  const saludo = "¡Hola! Soy MIRA 👋 ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  speakAfterVoices(saludo);

  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  setAvatarTalking(false);
}
window.addEventListener("DOMContentLoaded", initChat);

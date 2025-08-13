// =============== CONFIG ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// (opcional) fuerza un nombre exacto de voz si quieres
const PREFERRED_VOICE_NAME = "";

// Prompt
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Habla SIEMPRE en español, clara y estructurada.

- Primero una idea general en 1–2 frases.
- Luego pasos o listas cuando ayuden.
- Fórmulas EN GRANDE con LaTeX usando $$ ... $$.
- Usa símbolos/unidades cuando aplique (m/s, °C, N).
- Cuando pidan “la fórmula”, da explicación breve, fórmula y define variables en texto.
`;

// ============ AVATAR ============
let __innerAvatarSvg = null;
function hookAvatarInnerSvg() {
  const obj = document.getElementById("avatar-mira");
  if (!obj) return;
  const connect = () => { try { __innerAvatarSvg = obj.contentDocument?.documentElement || null; } catch { __innerAvatarSvg = null; } };
  if (obj.contentDocument) connect();
  obj.addEventListener("load", connect);
}
function setAvatarTalking(v) {
  const avatar = document.getElementById("avatar-mira");
  if (!avatar) return;
  avatar.classList.toggle("pulse", !!v);
  avatar.classList.toggle("still", !v);
  if (__innerAvatarSvg) {
    __innerAvatarSvg.classList.toggle("talking", !!v);
    __innerAvatarSvg.style.setProperty("--level", v ? "0.9" : "0.3");
  }
}

// ============ UI ============
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
  const box = document.getElementById("chat-box");
  if (document.getElementById("thinking")) return;
  const div = document.createElement("div");
  div.id = "thinking";
  div.className = "msg assistant";
  div.innerHTML = `<div class="bubble">MIRA está pensando…</div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function hideThinking() { document.getElementById("thinking")?.remove(); }

// ============ TTS (femenina + lenta + fluida) ============
// — Limpieza: no leer emojis, código, $...$, urls, comandos —
function stripEmojis(s) {
  try { return s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ""); }
  catch { return s.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/gu, ""); }
}
function sanitizeForTTS(md) {
  let t = md || "";
  t = t.replace(/```[\s\S]*?```/g, " ");   // code blocks
  t = t.replace(/`[^`]*`/g, " ");          // inline code
  t = t.replace(/\$\$[\s\S]*?\$\$/g, " "); // LaTeX block
  t = t.replace(/\$[^$]*\$/g, " ");        // LaTeX inline
  t = t.replace(/https?:\/\/\S+/g, " ");   // URLs
  t = t.replace(/(^|\s)[#/][^\s]+/g, " "); // /comando o #tag
  t = t.replace(/[>*_~`{}\[\]()<>|]/g, " ");
  t = t.replace(/[•·\-] /g, " ");
  t = stripEmojis(t);
  // Suaviza encabezados "Título:" -> "Título. "
  t = t.replace(/:\s/g, ". ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Preferencias de voces femeninas e idioma
const VOICE_NAME_PREFS = [
  "Paloma","Elvira","Dalia","Lola","Paulina","Sabina","Helena",
  "Lucia","Lucía","Elena","Camila","Sofía","Sofia","Marina","Conchita",
  "Google español"
];
const VOICE_LANG_PREFS = ["es-CL","es-ES","es-MX","es-419","es"];

let voicesCache = [];
let speaking = false;
const speechQueue = [];

function refreshVoices(){ voicesCache = window.speechSynthesis.getVoices() || []; }
window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

function pickVoice(){
  refreshVoices();
  if (PREFERRED_VOICE_NAME) {
    const exact = voicesCache.find(v => (v.name||"").toLowerCase() === PREFERRED_VOICE_NAME.toLowerCase());
    if (exact) return exact;
  }
  const byName = voicesCache.find(v =>
    VOICE_NAME_PREFS.some(p => (v.name||"").toLowerCase().includes(p.toLowerCase())) &&
    VOICE_LANG_PREFS.some(l => (v.lang||"").toLowerCase().startsWith(l)));
  if (byName) return byName;
  const byLang = voicesCache.find(v => VOICE_LANG_PREFS.some(l => (v.lang||"").toLowerCase().startsWith(l)));
  return byLang || voicesCache[0] || null;
}

// Particionado en frases para lectura natural
function splitIntoChunks(text, maxLen = 200) {
  const parts = text.split(/(?<=[\.\!\?\:\;])\s+|\n+/g);
  const chunks = []; let buf = "";
  for (const p of parts) {
    const s = p.trim(); if (!s) continue;
    if ((buf + " " + s).trim().length <= maxLen) buf = (buf ? buf + " " : "") + s;
    else { if (buf) chunks.push(buf); (s.length<=maxLen) ? chunks.push(s) : chunks.push(...s.match(/.{1,200}/g)); buf = ""; }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// Pausa entre trozos para que suene más humano
const INTER_CHUNK_PAUSE_MS = 120;

function playNext() {
  const next = speechQueue.shift();
  if (!next) { speaking = false; setAvatarTalking(false); return; }

  const utter = new SpeechSynthesisUtterance(next);
  const v = pickVoice();
  if (v) utter.voice = v;
  utter.lang   = (v && v.lang) || "es-ES";
  utter.rate   = 0.94;  // 🔉 un poquito más lento
  utter.pitch  = 1.08;  // tono agradable
  utter.volume = 1;

  setAvatarTalking(true);
  utter.onend = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  utter.onerror = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);

  window.speechSynthesis.speak(utter);
  speaking = true;
}
function enqueueSpeak(text){ if (!text) return; speechQueue.push(text); if (!speaking) playNext(); }
function cancelAllSpeech(){ try{ window.speechSynthesis.cancel(); }catch{} speechQueue.length = 0; speaking = false; setAvatarTalking(false); }
function speakMarkdown(md){
  const plain = sanitizeForTTS(md);
  if (!plain) return;
  splitIntoChunks(plain, 200).forEach(c => enqueueSpeak(c));
}
function speakAfterVoices(md){
  if (window.speechSynthesis.getVoices().length) speakMarkdown(md);
  else {
    const once = () => { window.speechSynthesis.removeEventListener("voiceschanged", once); speakMarkdown(md); };
    window.speechSynthesis.addEventListener("voiceschanged", once);
  }
}

// ============ RENDER ============
function renderMarkdown(text){ return typeof marked !== "undefined" ? marked.parse(text) : text; }

// ============ WIKIPEDIA FALLBACK ============
async function wikiFallback(q){
  try {
    const r = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
    if (!r.ok) return null; const d = await r.json(); return d?.extract || null;
  } catch { return null; }
}

// ============ ENVÍO MENSAJE ============
async function sendMessage() {
  const input = document.getElementById("user-input");
  const userMessage = (input.value || "").trim();
  if (!userMessage) return;

  // si llega un mensaje nuevo, cortamos la lectura anterior
  cancelAllSpeech();

  // UI + guardado (usuario)
  appendMessage("user", renderMarkdown(userMessage));
  window.ChatStore?.saveMessage("user", userMessage);

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
      appendMessage("assistant", renderMarkdown(msg));
      window.ChatStore?.saveMessage("assistant", msg);
      return;
    }

    const data = JSON.parse(raw);
    let aiReply = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!aiReply) aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";

    const html = renderMarkdown(aiReply);
    appendMessage("assistant", html);
    window.ChatStore?.saveMessage("assistant", aiReply);

    // hablar TODA la respuesta de forma fluida
    speakMarkdown(aiReply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();

  } catch (err) {
    hideThinking();
    const msg = "Error de red o CORS al conectar con la IA.";
    appendMessage("assistant", renderMarkdown(msg));
    window.ChatStore?.saveMessage("assistant", msg);
    console.error("Network/JS error:", err);
  }
}

// ============ INICIO ============
function initChat() {
  hookAvatarInnerSvg();

  const input = document.getElementById("user-input");
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });
  document.getElementById("send-btn")?.addEventListener("click", sendMessage);

  const saludo = "¡Hola! Soy MIRA. ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  // No guardo el saludo en historial para no “ensuciar” títulos; si lo quieres, descomenta:
  // window.ChatStore?.saveMessage("assistant", saludo);
  speakAfterVoices(saludo);

  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  setAvatarTalking(false);
}
window.addEventListener("DOMContentLoaded", initChat);

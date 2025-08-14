// =============== CONFIG ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const PREFERRED_VOICE_NAME = "Microsoft Helena - Spanish (Spain)";

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
  appendHTML(`<div class="msg ${role}"><div class="bubble chat-markdown">${contentHTML}</div></div>`);
}
function showThinking(text = "MIRA está pensando…") {
  const box = document.getElementById("chat-box");
  if (document.getElementById("thinking")) return;
  const div = document.createElement("div");
  div.id = "thinking";
  div.className = "msg assistant";
  div.innerHTML = `<div class="bubble">${text}</div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function hideThinking() { document.getElementById("thinking")?.remove(); }

// ============ TTS (femenina + lenta + fluida) ============
// Limpieza: no leer emojis, código ni LaTeX
function stripEmojis(s) {
  try { return s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ""); }
  catch { return s.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/gu, ""); }
}
function sanitizeForTTS(md) {
  let t = md || "";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]*`/g, " ");
  t = t.replace(/\$\$[\s\S]*?\$\$/g, " ");
  t = t.replace(/\$[^$]*\$/g, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/(^|\s)[#/][^\s]+/g, " ");
  t = t.replace(/[>*_~`{}\[\]()<>|]/g, " ");
  t = t.replace(/[•·\-] /g, " ");
  t = stripEmojis(t);
  t = t.replace(/:\s/g, ". ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

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
if (window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);

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

const INTER_CHUNK_PAUSE_MS = 120;

function playNext() {
  const next = speechQueue.shift();
  if (!next) { speaking = false; setAvatarTalking(false); return; }
  const utter = new SpeechSynthesisUtterance(next);
  const v = pickVoice();
  if (v) utter.voice = v;
  utter.lang   = (v && v.lang) || "es-ES";
  utter.rate   = 0.94;
  utter.pitch  = 1.08;
  utter.volume = 1;
  setAvatarTalking(true);
  utter.onend = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  utter.onerror = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  try { window.speechSynthesis.speak(utter); } catch {}
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
  try{
    if (window.speechSynthesis?.getVoices().length) speakMarkdown(md);
    else {
      const once = () => { window.speechSynthesis.removeEventListener("voiceschanged", once); speakMarkdown(md); };
      window.speechSynthesis?.addEventListener("voiceschanged", once);
    }
  }catch(e){ /* no romper flujo en móvil */ }
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

// Guardar mensajes si está disponible ChatStore
async function saveMsg(role, content){
  try{ await window.ChatStore?.saveMessage?.(role, content); }catch{}
}

// ============ CLIENTE /api/chat ============
async function callChatAPI_base(url, messages, temperature) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature })
  });
  const raw = await resp.text();
  if (!resp.ok) {
    let msg = "Error al conectar con la IA.";
    if (resp.status === 401) msg += " (401: clave inválida o expirada)";
    else if (resp.status === 403) msg += " (403: CORS o acceso denegado)";
    else if (resp.status === 429) msg += " (429: límite de uso alcanzado)";
    else if (resp.status === 404) msg += " (404: endpoint no encontrado)";
    else msg += ` (HTTP ${resp.status})`;
    throw new Error(msg + `\n${raw || ""}`);
  }
  const data = JSON.parse(raw || "{}");
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

// Intenta /api/chat y si no existe, cae a /.netlify/functions/chat
async function callChatAPI(messages, temperature = 0.7) {
  try {
    return await callChatAPI_base("/api/chat", messages, temperature);
  } catch (e) {
    const msg = String(e?.message || "");
    if (/404|no encontrado|endpoint no encontrado|not\s*found/i.test(msg)) {
      return await callChatAPI_base("/.netlify/functions/chat", messages, temperature);
    }
    throw e;
  }
}
async function callLLMFromText(userText){
  return callChatAPI([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText }
  ]);
}

// ============ ENVÍO MENSAJE (texto) ============
async function sendMessage() {
  const input = document.getElementById("user-input");
  const userMessage = (input.value || "").trim();
  if (!userMessage) return;

  cancelAllSpeech();

  appendMessage("user", renderMarkdown(userMessage));
  saveMsg("user", userMessage);

  input.value = "";
  showThinking();

  let aiReply = "";
  let requestSucceeded = false;

  try {
    aiReply = await callLLMFromText(userMessage);
    hideThinking();

    if (!aiReply) {
      aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";
    }

    const html = renderMarkdown(aiReply);
    appendMessage("assistant", html);
    saveMsg("assistant", aiReply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
    requestSucceeded = true;
  } catch (err) {
    hideThinking();
    console.error("Chat request error:", err);
    if (!requestSucceeded) {
      const msg = "Error de red o CORS al conectar con la IA.";
      appendMessage("assistant", msg);
      saveMsg("assistant", msg);
    }
    return;
  }

  try { speakMarkdown(aiReply); } catch (e) { console.warn("TTS no disponible en este dispositivo:", e); }
}
window.sendMessage = sendMessage; // expone para index.html

// ============ PIPELINE DESDE VISIÓN ============
let __visionCtx = { ocrText: "" };
window.setVisionContext = function ({ ocrText = "" } = {}) { __visionCtx.ocrText = ocrText; };

/**
 * Encadena explicación con el LLM usando la respuesta del VQA.
 * @param {string} answerFromVision - Texto devuelto por /api/vision/qa
 * @param {string} question - Pregunta que escribió el usuario en “¿Qué quieres saber?”
 * @param {object} extras - { ocrText?: string, userMessage?: string }
 */
window.pipelineFromVision = async function (answerFromVision, question = "", extras = {}) {
  const ocrText = (extras.ocrText ?? __visionCtx.ocrText ?? "").trim();
  const userMessage = (extras.userMessage || "").trim();

  const prompt =
`Tenemos una consulta basada en una imagen.
${userMessage ? `Mensaje del usuario: """${userMessage}"""\n` : ""}
Pregunta específica sobre la imagen: """${question || "Resume el enunciado, datos clave y resuelve brevemente."}"""
Observaciones del modelo de visión (VQA): """${answerFromVision || "(vacío)"}"""
${ocrText ? `Texto reconocido (OCR): """${ocrText}"""\n` : ""}

Por favor:
1) Resume en 2–3 líneas el enunciado/datos relevantes.
2) Explica la estrategia de resolución (pasos, fórmulas si aplica).
3) Resuelve paso a paso con claridad.
4) Da el resultado final y una verificación breve.
Recuerda: usa LaTeX grande para fórmulas con $$ ... $$ cuando apliquen. Responde en español.`;

  showThinking("Analizando lo que aparece en la imagen…");

  try {
    const reply = await callChatAPI([
      { role: "system", content: SYSTEM_PROMPT },
      ...(userMessage ? [{ role: "user", content: userMessage }] : []),
      { role: "user", content: prompt }
    ], 0.7);

    hideThinking();
    appendMessage("assistant", renderMarkdown(reply));
    saveMsg("assistant", reply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
    try { speakMarkdown(reply); } catch {}
  } catch (err) {
    hideThinking();
    const detail = String(err?.message || err || "Error");
    appendMessage("assistant", `⚠️ No se pudo generar la explicación a partir de la imagen.\n\n\`\`\`\n${detail}\n\`\`\``);
  }
};

// ============ INICIO ============
function initChat() {
  hookAvatarInnerSvg();

  const input = document.getElementById("user-input");
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });
  document.getElementById("send-btn")?.addEventListener("click", sendMessage);

  const saludo = "¡Hola! Soy MIRA. ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  try { speakAfterVoices(saludo); } catch {}

  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  setAvatarTalking(false);
}
window.addEventListener("DOMContentLoaded", initChat);

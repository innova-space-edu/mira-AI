// =============== CONFIGURACIÓN ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const PREFERRED_VOICE_NAME = "Microsoft Helena - Spanish (Spain)";

// Prompt inicial para el LLM
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Habla SIEMPRE en español, clara y estructurada.
- Primero una idea general en 1–2 frases.
- Luego pasos o listas cuando ayuden.
- Fórmulas EN GRANDE con LaTeX usando $$ ... $$.
- Usa símbolos/unidades cuando aplique (m/s, °C, N).
- Cuando pidan “la fórmula”, da explicación breve, fórmula y define variables en texto.
`;

// Endpoints (intenta /api/* y si no, /.netlify/functions/*)
const BLIP_ENDPOINTS = ["/api/vision", "/.netlify/functions/vision"];
const OCR_ENDPOINTS  = ["/api/ocrspace", "/.netlify/functions/ocrspace"];

// ============ AVATAR ============
let __innerAvatarSvg = null;
function hookAvatarInnerSvg() {
  const obj = document.getElementById("avatar-mira");
  if (!obj) return;
  const connect = () => {
    try { __innerAvatarSvg = obj.contentDocument?.documentElement || null; } catch { __innerAvatarSvg = null; }
  };
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

// ============ UI helpers ============
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
  if (!box || document.getElementById("thinking")) return;
  const div = document.createElement("div");
  div.id = "thinking";
  div.className = "msg assistant";
  div.innerHTML = `<div class="bubble">${text}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function hideThinking() { document.getElementById("thinking")?.remove(); }

// ============ TTS ============
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
  t = t.replace(/(^|\s)[#\/][^\s]+/g, " ");
  t = t.replace(/[>*_~`{}\[\]()<>|]/g, " ");
  t = t.replace(/[•·\-] /g, " ");
  t = stripEmojis(t);
  t = t.replace(/:\s/g, ". ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
const VOICE_NAME_PREFS = ["Paloma","Elvira","Dalia","Lola","Paulina","Sabina","Helena","Lucia","Lucía","Elena","Camila","Sofía","Sofia","Marina","Conchita","Google español"];
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
  const parts = text.split(/(?<=[\.!?;:])\s+|\n+/g);
  const chunks = [];
  let buf = "";
  for (const p of parts) {
    const s = p.trim(); if (!s) continue;
    if ((buf + " " + s).trim().length <= maxLen) buf = (buf ? buf + " " : "") + s;
    else { if (buf) chunks.push(buf); (s.length <= maxLen) ? chunks.push(s) : chunks.push(...s.match(/.{1,200}/g)); buf = ""; }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
const INTER_CHUNK_PAUSE_MS = 120;
function playNext() {
  const next = speechQueue.shift();
  if (!next) { speaking = false; setAvatarTalking(false); return; }
  const utter = new SpeechSynthesisUtterance(next);
  const v = pickVoice(); if (v) utter.voice = v;
  utter.lang = (v && v.lang) || "es-ES"; utter.rate = 0.94; utter.pitch = 1.08; utter.volume = 1;
  setAvatarTalking(true);
  utter.onend = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  utter.onerror = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  try { window.speechSynthesis.speak(utter); } catch {}
  speaking = true;
}
function enqueueSpeak(text){ if (!text) return; speechQueue.push(text); if (!speaking) playNext(); }
function cancelAllSpeech(){ try{ window.speechSynthesis.cancel(); }catch{} speechQueue.length = 0; speaking = false; setAvatarTalking(false); }
function speakMarkdown(md){ const plain = sanitizeForTTS(md); if (!plain) return; splitIntoChunks(plain, 200).forEach(c => enqueueSpeak(c)); }
function speakAfterVoices(md){
  try{
    if (window.speechSynthesis?.getVoices().length) speakMarkdown(md);
    else {
      const once = () => { window.speechSynthesis.removeEventListener("voiceschanged", once); speakMarkdown(md); };
      window.speechSynthesis?.addEventListener("voiceschanged", once);
    }
  }catch(e){}
}

// ============ RENDER ============
function renderMarkdown(text){ return typeof marked !== "undefined" ? marked.parse(text) : text; }

// ============ Fallback Wikipedia ============
async function wikiFallback(q){
  try {
    const r = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
    if (!r.ok) return null; const d = await r.json(); return d?.extract || null;
  } catch { return null; }
}

// Guardado (si hay ChatStore)
async function saveMsg(role, content){ try{ await window.ChatStore?.saveMessage?.(role, content); }catch{} }

// ============ CLIENTE /api/chat (con fallback al proxy) ============
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
  // Soporta tanto formato OpenAI (choices) como tu proxy ({ok,text})
  const data = JSON.parse(raw || "{}");
  const viaProxy = typeof data?.text === "string" ? data.text : "";
  const viaOpenAI = data?.choices?.[0]?.message?.content?.trim() || "";
  return (viaProxy || viaOpenAI || "").trim();
}
async function callChatAPI(messages, temperature = 0.7) {
  try { 
    // 1) Si tienes /api/chat propio, úsalo
    return await callChatAPI_base("/api/chat", messages, temperature); 
  } catch (e) {
    const msg = String(e?.message || "");
    // 2) Fallback a Netlify Function estándar de este repo
    if (/404|no encontrado|endpoint no encontrado|not\s*found/i.test(msg)) {
      return await callChatAPI_base("/.netlify/functions/groq-proxy", messages, temperature);
    }
    throw e;
  }
}
async function callLLMFromText(userText){
  return callChatAPI([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userText }]);
}

// ===== File → Base64 =====
function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ============ VISIÓN (caption + OCR) ============
async function httpError(res) {
  let body = "";
  try { body = await res.text(); } catch {}
  const msg = `HTTP ${res.status} ${res.statusText}${body ? ` – ${body.slice(0,200)}` : ""}`;
  return new Error(msg);
}
function parseNiceError(err) {
  const s = String(err?.message || err);
  if (s.includes("401")) return "El servidor respondió 401 (revisa tokens/variables de entorno).";
  if (s.includes("429")) return "Límite de uso alcanzado (rate limit).";
  if (s.toLowerCase().includes("cors")) return "Bloqueo CORS (habilita tu dominio en el backend).";
  return s;
}

async function tryFetchVision(bodyJson){
  for (const url of BLIP_ENDPOINTS) {
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r); // si no es 404, no seguimos
  }
  const last = await fetch(BLIP_ENDPOINTS[BLIP_ENDPOINTS.length-1], { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
  if (!last.ok) throw await httpError(last);
  return last;
}

async function tryFetchOCR(bodyJson){
  for (const url of OCR_ENDPOINTS) {
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r);
  }
  const last = await fetch(OCR_ENDPOINTS[OCR_ENDPOINTS.length-1], { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
  if (!last.ok) throw await httpError(last);
  return last;
}

async function callBLIP(file) {
  const imageBase64 = await fileToBase64(file);
  // Tu Function espera imageBase64 (camelCase)
  const r = await tryFetchVision({ imageBase64 });
  const data = await r.json();
  const desc = data?.caption || data?.description || data?.summary_text || "";
  if (!desc) throw new Error("Respuesta de visión inválida (caption).");
  return desc;
}
async function callOCR(file) {
  const imageBase64 = await fileToBase64(file);
  const r = await tryFetchOCR({ imageBase64, language: "spa" });
  const data = await r.json();
  if (typeof data?.text !== "string") throw new Error("Respuesta OCR inválida.");
  return data.text.trim();
}

async function analyzeImages(files) {
  const results = [];
  for (const file of files) {
    const [blip, ocr] = await Promise.allSettled([ callBLIP(file), callOCR(file) ]);
    const desc = blip.status === "fulfilled" ? blip.value : "";
    const text = ocr.status  === "fulfilled" ? ocr.value  : "";

    if (!desc && !text) {
      const why = (blip.reason && blip.reason.message) || (ocr.reason && ocr.reason.message) || "Fallo desconocido.";
      throw new Error(why);
    }

    const block = [
      desc ? `• **Descripción (IA):** ${desc}` : "",
      text ? `• **Texto detectado (OCR):** ${text}` : ""
    ].filter(Boolean).join("\n");

    results.push(block);
  }
  return results.map((b,i) => `Imagen ${i+1}:\n${b}`).join("\n\n");
}

// ============ PIPELINE VISIÓN → LLM ============
let __visionCtx = { ocrText: "" };
window.setVisionContext = function({ ocrText = "" } = {}) { __visionCtx.ocrText = ocrText; };

window.pipelineFromVision = async function(answerFromVision, question = "", extras = {}) {
  const ocrText = (extras.ocrText ?? __visionCtx.ocrText ?? "").trim();
  const userMessage = (extras.userMessage || "").trim();

  const prompt =
`Tenemos una consulta basada en una imagen.
${userMessage ? `Mensaje del usuario: """${userMessage}"""\n` : ""}
Pregunta específica sobre la imagen: """${question || "Resume el enunciado, datos clave y resuelve brevemente."}"""
Observaciones del modelo de visión (VQA/Caption): """${answerFromVision || "(vacío)"}"""
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

// ============ ENVÍO MENSAJE ============
const $fileInput   = document.getElementById("fileInput");
const $attachBtn   = document.getElementById("attachBtn");
const $attachMenu  = document.getElementById("attachMenu");
const $attachImageOption = document.getElementById("attachImageOption");
const $attachments = document.getElementById("attachments");
let attachments = []; // { file, urlPreview }

function renderAttachmentChips(){
  if (!$attachments) return;
  $attachments.innerHTML = "";
  attachments.forEach(att => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.innerHTML = `<img src="${att.urlPreview}" alt="img"><span>${att.file.name}</span>`;
    $attachments.appendChild(chip);
  });
}

// Menú “+”
$attachBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if ($attachMenu) {
    const isHidden = $attachMenu.classList.contains("hidden");
    $attachMenu.classList.toggle("hidden", !isHidden);
    $attachBtn.setAttribute("aria-expanded", String(isHidden));
  }
});
document.addEventListener("click", () => { if ($attachMenu) $attachMenu.classList.add("hidden"); });
$attachMenu?.addEventListener("click", (e)=> e.stopPropagation());

// Opción imagen
$attachImageOption?.addEventListener("click", (e) => {
  e.stopPropagation();
  $fileInput?.click();
  if ($attachMenu) $attachMenu.classList.add("hidden");
});

// Selección de archivos
$fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    const url = URL.createObjectURL(f);
    attachments.push({ file: f, urlPreview: url });
  }
  renderAttachmentChips();
  if ($fileInput) $fileInput.value = "";
});

// Enter y botón enviar
(function bindEnterSend(){
  const input = document.getElementById("user-input");
  const btn   = document.getElementById("send-btn");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }
  btn?.addEventListener("click", sendMessage);
})();

async function sendMessage() {
  const input = document.getElementById("user-input");
  const userMessage = (input?.value || "").trim();
  if (!userMessage && attachments.length === 0) return;

  cancelAllSpeech();

  // Mensaje del usuario
  let htmlUser = "";
  if (userMessage) htmlUser += renderMarkdown(userMessage);
  if (attachments.length) {
    const g = attachments.map(a => `<img src="${a.urlPreview}" alt="adjunto" class="max-w-[120px] rounded-lg border border-purple-800 mr-1 mb-1"/>`).join("");
    htmlUser += `<div class="mt-2 flex flex-wrap gap-2">${g}</div>`;
  }
  appendMessage("user", htmlUser);
  saveMsg("user", userMessage || (attachments.length ? "[Imagen adjunta]" : ""));

  // Limpieza y copia de archivos
  if (input) input.value = "";
  const localUrls = attachments.map(a => a.urlPreview);
  const files     = attachments.map(a => a.file);
  attachments = []; renderAttachmentChips();

  let aiReply = "";
  let requestSucceeded = false;

  try {
    if (files.length > 0) {
      showThinking("Analizando imagen…");
      const visualContext = await analyzeImages(files); // Visión + OCR automáticamente
      hideThinking();

      const question = userMessage || "Describe y analiza detalladamente la(s) imagen(es).";
      await window.pipelineFromVision(visualContext, question, { userMessage });
      requestSucceeded = true;
    } else {
      showThinking();
      aiReply = await callLLMFromText(userMessage);
      hideThinking();

      if (!aiReply) aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";

      const html = renderMarkdown(aiReply);
      appendMessage("assistant", html);
      saveMsg("assistant", aiReply);
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
      requestSucceeded = true;
    }
  } catch (err) {
    hideThinking();
    console.error("Chat/Visión error:", err);
    const msg = "⚠️ Error en análisis/consulta. " + parseNiceError(err);
    appendMessage("assistant", msg);
    saveMsg("assistant", msg);
  } finally {
    localUrls.forEach(u => URL.revokeObjectURL(u));
  }

  try { if (requestSucceeded) speakMarkdown(aiReply); } catch (e) { console.warn("TTS no disponible:", e); }
}
window.sendMessage = sendMessage;

// ============ INICIALIZACIÓN ============
function initChat() {
  hookAvatarInnerSvg();
  const saludo = "¡Hola! Soy MIRA. ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  try { speakAfterVoices(saludo); } catch {}
  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  setAvatarTalking(false);
}
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

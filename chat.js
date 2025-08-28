/* === chat.js completo (frontend) === */
// =============== CONFIGURACIÓN ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // Groq (rápido)
const OPENROUTER_MODEL_PRIMARY   = "qwen/qwen-2.5-32b-instruct";      // potente
const OPENROUTER_MODEL_FALLBACK  = "meta-llama/llama-3.1-70b-instruct";

const PREFERRED_VOICE_NAME = "Microsoft Helena - Spanish (Spain)";

// Prompt robusto para generación de imágenes (t2i)
const IMAGE_SYSTEM_PROMPT = `
Eres un generador de imágenes que sigue instrucciones con fidelidad cultural y de estilo.
Reglas:
- No inventes elementos fuera del prompt del usuario.
- Si el prompt incluye país, cultura o vestimenta típica, respétalos con detalles auténticos.
- Mantén composición clara: sujeto principal en foco, fondo coherente y bien iluminado.
- Si se pide texto superpuesto (título o leyenda), colócalo legible y sin errores de ortografía.
- Evita manos deformes, texto con artefactos, proporciones irreales y objetos duplicados.
- No uses marcas comerciales salvo que el usuario lo pida explícitamente.
`;

// Prompt inicial para el LLM (robusto, multiarea)
const SYSTEM_PROMPT = `
Eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Habla SIEMPRE en español, con claridad y estructura:

1) Abre con una idea general en 1–2 frases.
2) Luego muestra pasos o listas si aportan claridad.
3) Las FÓRMULAS deben ir en LaTeX GRANDE con $$ ... $$.
4) Usa símbolos/unidades correctos (m/s, °C, N, J, mol/L, etc).
5) Cuando pidan “la fórmula”, da: breve explicación, fórmula y define variables.

### Estilo general
- Sé preciso y conciso. Evita jergas innecesarias. Nombra supuestos si faltan datos.
- Cuando calcules, muestra el razonamiento con unidades, redondeo y verificación.
- Da alternativas o verificaciones si existen caminos distintos.

### Lengua/Escritura
- Resume y reescribe manteniendo sentido. Ofrece títulos, subtítulos y viñetas.
- Para “ensayo”, “explica” o “profundiza”, organiza en: introducción, desarrollo y cierre.

### Matemáticas y Física
- Define variables. Muestra sustitución numérica y unidades. Incluye comprobación dimensional.
- Si hay múltiples métodos (p. ej., trigonometría vs. vectores), di cuál eliges y por qué.

### Química y Biología
- Indica condiciones (T, P, pH, solvente). Balancea ecuaciones químicas si aplica.
- Explica mecanismos o procesos con pasos numerados.

### Programación/Tecnología
- Indica lenguaje, versión y librerías. Da un ejemplo mínimo funcional.
- Divide en pasos: “Análisis”, “Algoritmo”, “Código”, “Pruebas”, “Complejidad”.
- Evita dependencias innecesarias. Señala consideraciones de seguridad.

### Datos/Tablas
- Si no hay datos suficientes, solicita explícitamente lo faltante o asume con criterio y dilo.

### Razonamiento
- Justifica tus decisiones y señala errores comunes. Da referencias conceptuales cuando aporte.
`;

// Endpoints (intenta /api/* y si no, /.netlify/functions/*)
const CAPTION_ENDPOINTS = ["/api/caption", "/.netlify/functions/caption"];   // (queda disponible, ya no se usa)
const OCR_ENDPOINTS     = ["/api/ocrspace", "/.netlify/functions/ocrspace"];
const VQA_ENDPOINTS     = ["/api/vqa", "/.netlify/functions/vqa"];
const T2I_ENDPOINTS     = ["/api/t2i", "/.netlify/functions/t2i"];            // Text->image

// NUEVO: endpoint unificado de visión (describe/qa/ocr)
const VISION_ENDPOINTS  = ["/api/vision", "/.netlify/functions/vision"];

// NUEVO: endpoints para OpenRouter (texto potente). Si no existen, haremos fallback a Groq.
const OPENROUTER_ENDPOINTS = ["/api/openrouter", "/.netlify/functions/openrouter"];


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

/* === Mensaje con transición === */
function appendMessage(role, contentHTML) {
  const chatBox = document.getElementById("chat-box");
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble chat-markdown enter";
  bubble.dataset.role = role;
  bubble.classList.add(role === "assistant" ? "from-left" : "from-right");
  bubble.innerHTML = contentHTML;

  wrap.appendChild(bubble);
  chatBox.appendChild(wrap);

  requestAnimationFrame(() => {
    bubble.classList.add("show");
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

function showThinking(text = "MIRA está pensando…") {
  const box = document.getElementById("chat-box");
  if (!box || document.getElementById("thinking")) return;
  const div = document.createElement("div");
  div.id = "thinking";
  div.className = "msg assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble chat-markdown enter from-left";
  bubble.innerHTML = text;
  div.appendChild(bubble);
  box.appendChild(div);
  requestAnimationFrame(() => bubble.classList.add("show"));
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
    else { 
      if (buf) chunks.push(buf);
      (s.length <= maxLen) ? chunks.push(s) : chunks.push(...s.match(/.{1,200}/g));
      buf = ""; 
    }
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
  utter.lang = (v && v.lang) || "es-ES"; 
  utter.rate = 0.94; 
  utter.pitch = 1.08; 
  utter.volume = 1;
  setAvatarTalking(true);
  utter.onend = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  utter.onerror = () => setTimeout(playNext, INTER_CHUNK_PAUSE_MS);
  try { window.speechSynthesis.speak(utter); } catch {}
  speaking = true;
}
function enqueueSpeak(text){ if (!text) return; speechQueue.push(text); if (!speaking) playNext(); }
function cancelAllSpeech(){ 
  try{ window.speechSynthesis.cancel(); }catch{} 
  speechQueue.length = 0; 
  speaking = false; 
  setAvatarTalking(false); 
}
function speakMarkdown(md){ 
  const plain = sanitizeForTTS(md); 
  if (!plain) return; 
  splitIntoChunks(plain, 200).forEach(c => enqueueSpeak(c)); 
}
function speakAfterVoices(md){
  try{
    if (window.speechSynthesis?.getVoices().length) speakMarkdown(md);
    else {
      const once = () => { 
        window.speechSynthesis.removeEventListener("voiceschanged", once); 
        speakMarkdown(md); 
      };
      window.speechSynthesis?.addEventListener("voiceschanged", once);
    }
  }catch(e){}
}

// ============ RENDER ============
function renderMarkdown(text){ 
  return (typeof marked !== "undefined") ? marked.parse(text) : text; 
}

// ============ Fallback Wikipedia ============
async function wikiFallback(q){
  try {
    const r = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
    if (!r.ok) return null; 
    const d = await r.json(); 
    return d?.extract || null;
  } catch { return null; }
}

// Guardado (si hay ChatStore)
async function saveMsg(role, content){ 
  try{ await window.ChatStore?.saveMessage?.(role, content); }catch{} 
}

// ======== Normalización transporte (evita ByteString 8211) ========
function normalizeForTransport(s){
  return String(s || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}
function sanitizeMessages(msgs){
  return (msgs||[]).map(m => ({ ...m, content: normalizeForTransport(m.content) }));
}

// ============ CLIENTES /api/chat y /api/openrouter ============
async function callChatAPI_base(url, model, messages, temperature) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "Accept": "application/json" },
    body: JSON.stringify({ model, messages: sanitizeMessages(messages), temperature })
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
  const viaProxy = typeof data?.text === "string" ? data.text : "";
  const viaOpenAI = data?.choices?.[0]?.message?.content?.trim() || "";
  return (viaProxy || viaOpenAI || "").trim();
}

async function callGroq(messages, temperature = 0.7, model = MODEL) {
  try { 
    return await callChatAPI_base("/api/chat", model, messages, temperature); 
  } catch (e) {
    const msg = String(e?.message || "");
    if (/404|no encontrado|endpoint no encontrado|not\s*found/i.test(msg)) {
      // <<< corregido: fallback correcto a la función Netlify existente
      return await callChatAPI_base("/.netlify/functions/chat", model, messages, temperature);
    }
    throw e;
  }
}

async function callOpenRouter(messages, temperature = 0.7, model = OPENROUTER_MODEL_PRIMARY) {
  let lastErr = null;
  for (const url of OPENROUTER_ENDPOINTS) {
    try {
      return await callChatAPI_base(url, model, messages, temperature);
    } catch (e) {
      lastErr = e;
      // Si el endpoint no existe (404), probamos el siguiente
      if (!/404|not\s*found|no encontrado/i.test(String(e?.message||""))) throw e;
    }
  }
  // Si no hay endpoint OpenRouter, caemos a Groq para no romper UX
  if (lastErr) console.warn("OpenRouter no disponible, usando Groq. Detalle:", lastErr?.message||lastErr);
  return await callGroq(messages, temperature, MODEL);
}

async function callLLMFromText(userText, opts = {}) {
  const { forceProvider = "auto" } = opts;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText }
  ];

  if (forceProvider === "groq") {
    return callGroq(messages, 0.7, MODEL);
  }
  if (forceProvider === "openrouter") {
    try {
      return await callOpenRouter(messages, 0.75, OPENROUTER_MODEL_PRIMARY);
    } catch {
      return await callOpenRouter(messages, 0.75, OPENROUTER_MODEL_FALLBACK);
    }
  }

  // auto: decide según complejidad (ver detectComplexTextIntent)
  const complex = detectComplexTextIntent(userText);
  if (complex.isComplex) {
    try {
      return await callOpenRouter(messages, 0.75, OPENROUTER_MODEL_PRIMARY);
    } catch {
      return await callOpenRouter(messages, 0.75, OPENROUTER_MODEL_FALLBACK);
    }
  }
  return callGroq(messages, 0.7, MODEL);
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
// NUEVO: DataURL → sólo base64 sin prefijo
function dataUrlToB64(dataUrl) {
  if (!dataUrl) return "";
  const m = String(dataUrl).match(/^data:.*?;base64,(.*)$/);
  return m ? m[1] : dataUrl;
}

// Normalizador (OCR/visión)
function normalizeText(txt){
  if (!txt) return "";
  return String(txt)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00A0]/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}

// ============ VISIÓN util ============
const DEFAULT_FETCH_TIMEOUT_MS = 25000;
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(t); }
}
async function httpError(res) {
  let body = ""; try { body = await res.text(); } catch {}
  return new Error(`HTTP ${res.status} ${res.statusText}${body ? ` – ${body.slice(0,200)}` : ""}`);
}
function parseNiceError(err) {
  const s = String(err?.message || err);
  if (s.includes("401")) return "El servidor respondió 401 (revisa tokens/variables de entorno).";
  if (s.includes("429")) return "Límite de uso alcanzado (rate limit).";
  if (s.toLowerCase().includes("cors")) return "Bloqueo CORS (habilita tu dominio en el backend).";
  if (s.toLowerCase().includes("aborted")) return "La solicitud tardó demasiado (timeout).";
  return s;
}

// (caption legacy)
async function tryFetchCaption(formData){
  for (const url of CAPTION_ENDPOINTS) {
    const r = await fetchWithTimeout(url, { method:"POST", body: formData });
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r);
  }
  const last = await fetchWithTimeout(CAPTION_ENDPOINTS[CAPTION_ENDPOINTS.length-1], { method:"POST", body: formData });
  if (!last.ok) throw await httpError(last);
  return last;
}
async function callCaption(file) {
  const fd = new FormData();
  fd.append("image", file, file.name || "image.png");
  const r = await tryFetchCaption(fd);
  const data = await r.json();
  const desc = (typeof data?.text === "string" && data.text) ||
               data?.caption || data?.generated_text || "";
  if (!desc) throw new Error("Respuesta de caption vacía.");
  return String(desc).trim();
}

// OCR
async function tryFetchOCR(bodyJson){
  try {
    const b = { task: "ocr" };
    if (bodyJson?.imageBase64) b.imageB64 = dataUrlToB64(bodyJson.imageBase64);
    if (bodyJson?.imageUrl)   b.imageUrl  = bodyJson.imageUrl;
    const r = await tryFetchVision(b);
    if (r) return r;
  } catch (_e) {}
  for (const url of OCR_ENDPOINTS) {
    const r = await fetchWithTimeout(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r);
  }
  const last = await fetchWithTimeout(
    OCR_ENDPOINTS[OCR_ENDPOINTS.length-1], 
    { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) }
  );
  if (!last.ok) throw await httpError(last);
  return last;
}
async function callOCR(file) {
  const imageBase64 = await fileToBase64(file);
  const r = await tryFetchOCR({ imageBase64, language: "spa" });
  const data = await r.json();
  const text = (typeof data?.content === "string" ? data.content :
               (typeof data?.text === "string" ? data.text :
               (data?.ocrText || data?.result || "")));
  if (typeof text !== "string") throw new Error("Respuesta OCR inválida.");
  return normalizeText(text.trim());
}

// VQA
async function tryFetchVQA(bodyJson){
  try {
    const b = { task: "qa", question: bodyJson?.prompt || bodyJson?.question || "" };
    if (bodyJson?.imageBase64) b.imageB64 = dataUrlToB64(bodyJson.imageBase64);
    if (bodyJson?.imageUrl)   b.imageUrl  = bodyJson.imageUrl;
    const r = await tryFetchVision(b);
    if (r) return r;
  } catch (_e) {}
  for (const url of VQA_ENDPOINTS) {
    const r = await fetchWithTimeout(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r);
  }
  const last = await fetchWithTimeout(
    VQA_ENDPOINTS[VQA_ENDPOINTS.length-1], 
    { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) }
  );
  if (!last.ok) throw await httpError(last);
  return last;
}
async function callVQA(file, question) {
  const imageBase64 = await fileToBase64(file);
  const q = (question && String(question).trim()) || "Describe la imagen con detalle e indica qué texto aparece.";
  const r = await tryFetchVQA({ imageBase64, prompt: q });
  const data = await r.json();
  const ans =
    (typeof data?.content === "string" && data.content) ||
    (typeof data?.text === "string" && data.text) ||
    data?.answer || data?.generated_text || data?.label ||
    (Array.isArray(data) && data[0]?.generated_text) || "";
  if (!ans) throw new Error("Respuesta VQA inválida.");
  return normalizeText(String(ans).trim());
}

// Vision unificado
async function tryFetchVision(bodyJson){
  let lastNon404 = null;
  for (const url of VISION_ENDPOINTS) {
    const r = await fetchWithTimeout(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) });
    if (r.ok) return r;
    if (r.status !== 404) { lastNon404 = await httpError(r); }
  }
  if (lastNon404) throw lastNon404;
  return null;
}
async function callVision(file, { task = "describe", question = "" } = {}) {
  const imageBase64 = await fileToBase64(file);
  const r = await tryFetchVision({ task, imageB64: dataUrlToB64(imageBase64), question });
  if (!r) throw new Error("Endpoint de visión no disponible.");
  const data = await r.json();
  const content =
    (typeof data?.content === "string" && data.content) ||
    (typeof data?.text === "string" && data.text) ||
    data?.answer || data?.caption || data?.generated_text || "";
  if (!content) throw new Error("Respuesta de visión vacía.");
  return normalizeText(String(content).trim());
}

// Intent imágenes
function detectImageIntent(text){
  const t = (text||"").toLowerCase();
  const ocr = /\b(ocr|lee(?:r)?(?:\s*el)?\s*texto|transcribe|extrae\s*texto|copiar\s*texto|reconoce\s*texto|detectar\s*texto)\b/.test(t);
  const describe = /\b(describe|describir|descripción|descripcion|reconoce|identifica|analiza|detalla|resume\s*la\s*imagen)\b/.test(t);
  const qa = /(\?|¿)|\b(pregunta|respónd(?:e|eme)|qué\s+hay|que\s+hay|qué\s+dice|que\s+dice|qué\s+color|dónde|donde|cuánto|cuanto|por\s*qué|porque)\b/.test(t);
  const solve = /\b(resuelve|resolver|soluciona|calcula|desarrolla|demuestra|halla|obt[eé]n|explica|aplica)\b/.test(t);
  const analyze = /\b(analiza|analizar|estudia|evalúa|evalua|interpreta|diagnostica|clasifica|segmenta)\b/.test(t);
  return { ocr, describe, qa, solve, analyze };
}
async function analyzeImagesSmart(files, userMessage) {
  const intent = detectImageIntent(userMessage);
  const wantsAny = intent.ocr || intent.describe || intent.qa || intent.solve || intent.analyze;
  const results = [];
  let aggregatedOCR = "";
  for (const [idx, file] of files.entries()) {
    const perImageBlocks = [];
    const doDescribe = intent.describe || (!wantsAny);
    const doOCR      = intent.ocr      || (!wantsAny);
    const doQA       = intent.qa;

    if (doDescribe) {
      try {
        const desc = await callVision(file, { task: "describe" });
        if (desc) perImageBlocks.push(`• **Descripción:** ${desc}`);
      } catch (e) {
        try {
          const alt = await callVQA(file, "Describe con detalle la imagen (objetos, texto visible, contexto).");
          if (alt) perImageBlocks.push(`• **Descripción:** ${alt}`);
        } catch (ee) {
          perImageBlocks.push(`• **Descripción:** (error: ${escapeHtml(String(e.message||e))})`);
        }
      }
    }

    if (doOCR) {
      try {
        const text = await callOCR(file);
        if (text) {
          aggregatedOCR += (aggregatedOCR ? "\n\n" : "") + text;
          perImageBlocks.push(`• **Texto (OCR):** ${text}`);
        }
      } catch (e) {
        try {
          const alt = await callVision(file, { task: "ocr" });
          if (alt) {
            aggregatedOCR += (aggregatedOCR ? "\n\n" : "") + alt;
            perImageBlocks.push(`• **Texto (OCR):** ${alt}`);
          }
        } catch (ee) {
          perImageBlocks.push(`• **Texto (OCR):** (error: ${escapeHtml(String(e.message||e))})`);
        }
      }
    }

    if (doQA) {
      const q = userMessage && /[?¿]/.test(userMessage) ? userMessage : "Responde a la pregunta implícita sobre la imagen.";
      try {
        const ans = await callVision(file, { task: "qa", question: q });
        if (ans) perImageBlocks.push(`• **Respuesta a la pregunta:** ${ans}`);
      } catch (e) {
        try {
          const alt = await callVQA(file, q);
          if (alt) perImageBlocks.push(`• **Respuesta a la pregunta:** ${alt}`);
        } catch (ee) {
          perImageBlocks.push(`• **Respuesta a la pregunta:** (error: ${escapeHtml(String(e.message||e))})`);
        }
      }
    }

    if (!perImageBlocks.length) perImageBlocks.push("• (No se pudo obtener información de la imagen).");
    results.push(`Imagen ${idx+1}:\n${perImageBlocks.join("\n")}`);
  }
  window.setVisionContext({ ocrText: aggregatedOCR });
  const shouldSolve = intent.solve || intent.analyze;
  return { textBlock: results.join("\n\n"), shouldSolve };
}

// Complejidad
function detectComplexTextIntent(text) {
  const t = (text || "").toLowerCase();
  const patterns = [
    /detalla(me)?|paso a paso|expl[ií]came|profundiza|explaya(te)?|razona en detalle|analiza a fondo/,
    /resumen|resúmeme|haz un resumen|s[íi]ntesis|esquem[a|atiza]/,
    /traduce|traducci[oó]n|translate/,
    /ensayo|ensáyame|art[ií]culo|monograf[ií]a|redacci[oó]n extensa/,
    /dame un c[oó]digo|programa|algoritmo|implementa|optimiza|refactoriza|escribe en (js|javascript|python|java|c\+\+|c#|go|rust|sql)/,
    /pruebas unitarias|tests|testea|benchmark|complejidad (temporal|espacial)/,
    /demuestra|demostraci[oó]n|teorema|justifica|deriva|deduce|integral|derivada|l[ií]mites|probabilidad|estad[íi]stica/,
    /plan de estudio|curr[ií]culo|s[íi]labo|roadmap/,
    /diagram[as]?|arquitectura|diseña el sistema|requisitos|casos de uso/
  ];
  const isComplex = patterns.some(rx => rx.test(t));
  return { isComplex };
}

// INTENCIÓN NATURAL: T2I / I2T
function wantsT2I(text, hasFiles){
  const t = (text||"").toLowerCase();
  const genVerbs = /(genera|genérame|haz|hazme|crea|créame|crear|dibuja|pinta|píntame|ilustra|renderiza|construye|arma|modela)/i;
  const imgNoun  = /(imagen|logo|portada|banner|afiche|flyer|fondo|wallpaper|ilustración|dibujo|arte)/i;
  if (hasFiles) return genVerbs.test(t) && imgNoun.test(t);
  return genVerbs.test(t) || (genVerbs.test(t) && imgNoun.test(t));
}
function extractT2IPrompt(text){
  return (text||"")
    .replace(/(genera|genérame|haz|hazme|crea|créame|crear|dibuja|pinta|píntame|ilustra|renderiza|modela)\s*(una|un)?\s*(imagen|logo|banner|portada|afiche|flyer|fondo|wallpaper|ilustración|dibujo|arte)?\s*(de|del|de la|con)?/i, "")
    .trim();
}
function wantsCaptionIntention(text){
  return /(describe|reconoce|analiza|qué ves|que ves|dime sobre esta imagen)/i.test(text||"");
}

// Builder de prompt T2I
function buildImagePrompt(userPromptRaw) {
  const userPrompt = (userPromptRaw || "").trim();
  let aspect_ratio = "1:1";
  if (/\b(banner|portada|cover|encabezado)\b/i.test(userPrompt)) aspect_ratio = "16:9";
  if (/\b(afiche|flyer|poster|póster)\b/i.test(userPrompt)) aspect_ratio = "3:4";
  if (/\b(historia|story|reel|vertical)\b/i.test(userPrompt)) aspect_ratio = "9:16";

  const negative = [
    "manos deformes, dedos extra, texto ilegible, artefactos, duplicaciones",
    "proporciones irreales, ojos mal alineados, watermark, marca de agua",
    "ruido excesivo, glitches, desorden visual, fondos incoherentes"
  ].join(", ");

  const prompt = [
    IMAGE_SYSTEM_PROMPT.trim(),
    "",
    "Instrucciones del usuario (seguir literalmente):",
    `"${userPrompt}"`,
    "",
    "Estilo: realista/ilustración nítida, iluminación cinematográfica, colores vivos pero naturales.",
    "Composición: sujeto principal centrado, fondo coherente, profundidad y bokeh suave si aporta.",
    "Si se pide texto en la imagen, asegúrate de que esté escrito correctamente y sea legible."
  ].join("\n");

  return {
    prompt,
    negative_prompt: negative,
    options: {
      aspect_ratio,
      guidance: 6.5,
      safety: "strict",
      seed: Math.floor(Math.random() * 1e9)
    }
  };
}

// ======== Llamador T2I =========
async function tryFetchT2I(bodyJson){
  for (const url of T2I_ENDPOINTS) {
    const r = await fetchWithTimeout(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) }, 60000);
    if (r.ok) return r;
    if (r.status !== 404) throw await httpError(r);
  }
  const last = await fetchWithTimeout(
    T2I_ENDPOINTS[T2I_ENDPOINTS.length-1], 
    { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(bodyJson) }, 
    60000
  );
  if (!last.ok) throw await httpError(last);
  return last;
}

// ============ PIPELINE VISIÓN → LLM ============
let __visionCtx = { ocrText: "" };
window.setVisionContext = function({ ocrText = "" } = {}) { __visionCtx.ocrText = ocrText; };

window.pipelineFromVision = async function(answerFromVision, question = "", extras = {}) {
  const ocrText = normalizeText((extras.ocrText ?? __visionCtx.ocrText ?? "").trim());
  const userMessage = (extras.userMessage || "").trim();

  const prompt =
`Tenemos una consulta basada en una imagen.
${userMessage ? `Mensaje del usuario: """${userMessage}"""\n` : ""}
Pregunta específica sobre la imagen: """${question || "Resume el enunciado, datos clave y resuelve brevemente."}"""
Observaciones del modelo de visión (VQA/Caption): """${normalizeText(answerFromVision || "(vacío)")}"""
${ocrText ? `Texto reconocido (OCR): """${ocrText}"""\n` : ""}

Por favor:
1) Resume en 2–3 líneas el enunciado/datos relevantes.
2) Explica la estrategia de resolución (pasos, fórmulas si aplica).
3) Resuelve paso a paso con claridad.
4) Da el resultado final y una verificación breve.
Recuerda: usa LaTeX grande para fórmulas con $$ ... $$ cuando apliquen. Responde en español.`;

  showThinking("Analizando lo que aparece en la imagen…");

  try {
    const complex = detectComplexTextIntent(userMessage);
    const reply = complex.isComplex
      ? await callOpenRouter([
          { role: "system", content: SYSTEM_PROMPT },
          ...(userMessage ? [{ role: "user", content: userMessage }] : []),
          { role: "user", content: prompt }
        ], 0.75, OPENROUTER_MODEL_PRIMARY)
      : await callGroq([
          { role: "system", content: SYSTEM_PROMPT },
          ...(userMessage ? [{ role: "user", content: userMessage }] : []),
          { role: "user", content: prompt }
        ], 0.7, MODEL);

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

/* === Ventana flotante de adjuntos === */
function ensureFloatingBox(){
  const card = document.getElementById('chat-card');
  let box = document.getElementById('floating-attachments');
  if (!box) {
    box = document.createElement('div');
    box.id = 'floating-attachments';
    box.className = 'floating-attachments hidden';
    box.innerHTML = `
      <div class="fa-header">
        <span class="fa-title">Adjuntos</span>
        <button id="fa-clear" class="fa-clear" title="Quitar todos">✕</button>
      </div>
      <div id="fa-grid" class="fa-grid"></div>`;
    card.appendChild(box);
  }
  const btn = box.querySelector('#fa-clear');
  if (btn && !btn._wired){
    btn._wired = true;
    btn.addEventListener('click', ()=>{
      attachments.forEach(a=> URL.revokeObjectURL(a.urlPreview));
      attachments = [];
      renderAttachmentChips();
      renderFloatingPreviews();
      if ($fileInput) $fileInput.value = "";
    });
  }
}
function renderFloatingPreviews(){
  ensureFloatingBox();
  const box  = document.getElementById('floating-attachments');
  const grid = document.getElementById('fa-grid');
  if (!box || !grid) return;

  grid.innerHTML = "";
  if (!attachments.length){ box.classList.remove('show'); box.classList.add('hidden'); return; }

  attachments.slice(0,4).forEach((att, i)=>{
    const img = document.createElement('img');
    img.src   = att.urlPreview;
    img.alt   = `adjunto-${i+1}`;
    img.title = att.file?.name || `adjunto ${i+1}`;
    grid.appendChild(img);
  });
  box.classList.remove('hidden');
  box.classList.add('show');
}

function renderAttachmentChips(){
  if (!$attachments) return;
  $attachments.innerHTML = "";
  attachments.forEach(att => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.innerHTML = `<img src="${att.urlPreview}" alt="img"><span>${att.file.name}</span>`;
    $attachments.appendChild(chip);
  });
  renderFloatingPreviews();
}

// Menú “+”
$attachBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if ($attachMenu) {
    $attachMenu.classList.add("hidden");
    $attachBtn.setAttribute("aria-expanded", "false");
  }
  try { $fileInput?.click(); } catch {}
});
document.addEventListener("click", () => { if ($attachMenu) $attachMenu.classList.add("hidden"); });
$attachMenu?.addEventListener("click", (e)=> e.stopPropagation());
$attachImageOption?.addEventListener("click", (e) => {
  e.stopPropagation();
  $fileInput?.click();
  if ($attachMenu) $attachMenu.classList.add("hidden");
});
$fileInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    const url = URL.createObjectURL(f);
    attachments.push({ file: f, urlPreview: url });
  }
  renderAttachmentChips();
  if ($fileInput) $fileInput.value = "";
  document.getElementById("user-input")?.focus();
});

// ======== Envío principal ========
async function sendMessage() {
  const input = document.getElementById("user-input");
  const userMessage = (input?.value || "").trim();
  if (!userMessage && attachments.length === 0) return;

  cancelAllSpeech();

  let htmlUser = "";
  if (userMessage) htmlUser += renderMarkdown(userMessage);
  if (attachments.length) {
    const g = attachments.map(a => `<img src="${a.urlPreview}" alt="adjunto" class="max-w-[120px] rounded-lg border border-purple-800 mr-1 mb-1"/>`).join("");
    htmlUser += `<div class="mt-2 flex flex-wrap gap-2">${g}</div>`;
  }
  appendMessage("user", htmlUser);
  saveMsg("user", userMessage || (attachments.length ? "[Imagen adjunta]" : ""));

  if (input) input.value = "";
  const localUrls = attachments.map(a => a.urlPreview);
  const files     = attachments.map(a => a.file);
  attachments = []; renderAttachmentChips();

  let aiReply = "";
  let requestSucceeded = false;

  try {
    const hasFiles = files.length > 0;

    // Generación de imagen por texto
    if (!hasFiles && userMessage && wantsT2I(userMessage, false)) {
      const plain = extractT2IPrompt(userMessage) || userMessage;
      const { prompt, negative_prompt, options } = buildImagePrompt(plain);
      showThinking("Generando imagen…");
      const r = await tryFetchT2I({ prompt, negative_prompt, options, provider: "auto" });
      const data = await r.json();
      hideThinking();

      const src = data?.image || data?.imageUrl || (data?.imageB64 ? `data:image/png;base64,${data.imageB64}` : null);
      if (src) {
        const html = `<div class="space-y-2">
          <img src="${src}" alt="imagen generada" class="rounded-lg border border-white/10 max-w-full"/>
          ${plain ? `<div class="text-xs opacity-70">Prompt: ${escapeHtml(plain)}</div>` : ""}
        </div>`;
        appendMessage("assistant", html);
        try { window.Gallery?.add?.({ src, prompt: plain }); } catch {}
        saveMsg("assistant", "[Imagen generada]");
        requestSucceeded = true;
      } else {
        const err = data?.error || "Error desconocido en T2I.";
        appendMessage("assistant", `⚠️ Error generando la imagen: ${escapeHtml(err)}`);
      }
      return;
    }

    // Análisis de imagen
    if (hasFiles) {
      showThinking("Analizando imagen…");
      const { textBlock, shouldSolve } = await analyzeImagesSmart(files, userMessage || "");
      hideThinking();

      if (shouldSolve) {
        await window.pipelineFromVision(textBlock, userMessage || "Resume y resuelve", { userMessage });
      } else {
        const html = renderMarkdown(textBlock);
        appendMessage("assistant", html);
        saveMsg("assistant", textBlock);
        try { speakMarkdown(textBlock); } catch {}
      }
      requestSucceeded = true;
      return;
    }

    // Chat de texto normal
    showThinking();
    const complex = detectComplexTextIntent(userMessage);
    aiReply = complex.isComplex
      ? await callLLMFromText(userMessage, { forceProvider: "openrouter" })
      : await callLLMFromText(userMessage, { forceProvider: "groq" });
    hideThinking();

    if (!aiReply) aiReply = (await wikiFallback(userMessage)) || "Lo siento, no encontré una respuesta adecuada.";

    const html = renderMarkdown(aiReply);
    appendMessage("assistant", html);
    saveMsg("assistant", aiReply);
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
    requestSucceeded = true;
  } catch (err) {
    hideThinking();
    console.error("Chat/Visión error:", err);
    const msg = "⚠️ Error en análisis/consulta. " + parseNiceError(err);
    appendMessage("assistant", msg);
    saveMsg("assistant", msg);
  } finally {
    localUrls.forEach(u => URL.revokeObjectURL(u));
  }

  try { if (requestSucceeded && aiReply) speakMarkdown(aiReply); } catch (e) { console.warn("TTS no disponible:", e); }
}
window.sendMessage = sendMessage;

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ============ INICIALIZACIÓN ============
function wireComposer(){
  const sendBtn = document.getElementById("send-btn");
  const input   = document.getElementById("user-input");
  if (sendBtn && !sendBtn._wired){
    sendBtn._wired = true;
    sendBtn.addEventListener("click", (e)=>{ e.preventDefault(); sendMessage(); });
  }
  if (input && !input._wired){
    input._wired = true;
    input.addEventListener("keydown", (e)=>{
      if (e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });
  }
}
function initChat() {
  hookAvatarInnerSvg();
  wireComposer();
  const saludo = "¡Hola! Soy MIRA. ¿En qué puedo ayudarte hoy?";
  appendMessage("assistant", renderMarkdown(saludo));
  try { speakAfterVoices(saludo); } catch {}
  if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  setAvatarTalking(false);
}
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", initChat);
else initChat();

/* === Dictado por voz === */
(function initVoiceDictation() {
  const MicRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('btn-mic');
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  if (!micBtn) return;

  let recognition = null, listening = false, manualStop = false, lastCommitted = "";
  if (!MicRecognition) {
    micBtn.title = "Dictado no soportado en este navegador";
    micBtn.setAttribute("disabled", "true");
    micBtn.classList.add('mic-disabled');
    return;
  }
  recognition = new MicRecognition();
  recognition.lang = 'es-CL';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "", finalChunk = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i], txt = res[0].transcript;
      if (res.isFinal) finalChunk += txt + " "; else interim += txt + " ";
    }
    input.value = (lastCommitted + finalChunk + interim).trim();
    if (finalChunk) lastCommitted = (lastCommitted + finalChunk).trim() + " ";
  };
  recognition.onstart = () => {
    listening = true; manualStop = false;
    lastCommitted = input.value ? (input.value.trim() + " ") : "";
    micBtn.classList.add('recording'); micBtn.title = "Escuchando… toca para detener";
  };
  recognition.onerror = (e) => { console.warn("SpeechRecognition error:", e); micBtn.title = "Error de micrófono: " + (e.error || "desconocido"); };
  recognition.onend = () => {
    listening = false; micBtn.classList.remove('recording');
    if (!manualStop) { try { recognition.start(); } catch {} }
    else micBtn.title = "Dictar por voz";
  };
  micBtn.addEventListener('click', () => {
    if (!recognition) return;
    if (!listening) { manualStop = false; try { recognition.start(); } catch (err) { console.error("No se pudo iniciar el dictado:", err); } }
    else { manualStop = true; try { recognition.stop(); } catch {} }
  });
  if (sendBtn) {
    sendBtn.addEventListener('click', () => { if (listening) { manualStop = true; try { recognition.stop(); } catch {} } });
  }
})();

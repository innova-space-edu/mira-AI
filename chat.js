// =============== CONFIG ===============
const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Prompt del sistema
const SYSTEM_PROMPT = `
Tú eres MIRA (Modular Intelligent Responsive Assistant), creada por Innova Space.
Responde SIEMPRE en español, ordenada y clara, con buen uso de puntuación.
Primero explica con palabras simples; luego, si corresponde, muestra la fórmula en LaTeX usando $...$ o $$...$$.
No expliques el código LaTeX ni los signos de dólar. Usa listas y títulos cuando ayuden.
Si el texto del usuario está incompleto o mal escrito, interprétalo y ofrece 1–2 alternativas breves.
Si no estás segura, da una respuesta tentativa y pide una aclaración corta.
`;

// ============ AVATAR ANIMACIÓN ============

// Referencia al <svg> interno del <object id="avatar-mira">
let __innerAvatarSvg = null;

// Engancha el SVG interno cuando <object> cargue
function hookAvatarInnerSvg() {
  const obj = document.getElementById("avatar-mira");
  if (!obj) return;
  const connect = () => {
    try {
      __innerAvatarSvg = obj.contentDocument?.documentElement || null;
    } catch {
      __innerAvatarSvg = null;
    }
  };
  // Por si ya estuviera cargado:
  if (obj.contentDocument) connect();
  // Y cuando termine de cargar:
  obj.addEventListener("load", connect);
}

function setAvatarTalking(isTalking) {
  const avatar = document.getElementById("avatar-mira");
  if (!avatar) return;
  avatar.classList.toggle("pulse", !!isTalking);
  avatar.classList.toggle("still", !isTalking);

  // Activa/desactiva animación dentro del SVG embebido
  if (__innerAvatarSvg) {
    __innerAvatarSvg.classList.toggle("talking", !!isTalking);
    __innerAvatarSvg.style.setProperty("--level", isTalking ? "0.9" : "0.3");
  }
}

// ============ UTILIDADES UI ===============
function appendHTML(html) {
  const chatBox = document.getElementById("chat-box");
  chatBox.insertAdjacentHTML("beforeend", html);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMessage(role, contentHTML) {
  const who = role === "user" ? "Tú" : "MIRA";
  appendHTML(`<div class="my-2"><strong>${who}:</strong> <span class="chat-markdown">${contentHTML}</span></div>`);
}

function showThinking() {
  const chatBox = document.getElementById("chat-box");
  if (document.getElementById("thinking")) return;
  const thinking = document.createElement("div");
  thinking.id = "thinking";
  thinking.className = "text-purple-300 italic my-1";
  thinking.innerHTML = `<span class="animate-pulse">MIRA está pensando<span class="animate-bounce">...</span></span>`;
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
    const res = await fetch(
      `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
    );
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
    // 🔐 Usamos el proxy serverless en Netlify (la key vive en GROQ_API_KEY)
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
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
    console.log("Proxy /api/chat raw response:", raw);

    hideThinking();

    if (!response.ok) {
      console.error("Proxy error:", response.status, raw);
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
  // Conectar con el SVG interno del avatar
  hookAvatarInnerSvg();

  const input = document.getElementById("user-input");
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });

  document.getElementById("send-btn")?.addEventListener("click", sendMessage);

  // Saludo inmediato (habla "al tiro")
  setTimeout(() => {
    const chatBox = document.getElementById("chat-box");
    const hasGreeting = chatBox && chatBox.textContent.trim().length > 0;

    const saludo = "¡Hola! Soy MIRA, tu asistente virtual. ¿En qué puedo ayudarte hoy?";

    // Si no hay saludo en el DOM, lo agregamos
    if (!hasGreeting) {
      appendMessage("assistant", renderMarkdown(saludo));
    }

    // Siempre hablar (aunque el saludo ya exista en el HTML)
    speak(saludo);

    if (window.MathJax?.typesetPromise) MathJax.typesetPromise();
  }, 250); // pequeño delay para que el DOM esté listo

  setAvatarTalking(false);
}

window.addEventListener("DOMContentLoaded", initChat);

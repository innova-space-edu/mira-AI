// netlify/functions/vision.js
// Visión unificado: { task: "describe"|"qa"|"ocr", imageB64|imageUrl, question? }
// Requiere: OPENROUTER_API_KEY
// Opcional: OPENROUTER_SITE_URL, OPENROUTER_APP_NAME, VISION_MODEL

const ALLOW_ORIGIN = "*";
const ORIGIN_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const VALID_MODELS = [
  process.env.VISION_MODEL, // si la defines, se prueba primero
  "qwen/qwen-2-vl-72b-instruct",
  "meta-llama/llama-3.2-11b-vision-instruct",
  "openai/gpt-4o-mini", // si tu cuenta lo tiene disponible en OpenRouter
].filter(Boolean);

// Sanitiza headers ASCII (evita ByteString 8211)
const safeHeader = (v, f = "") =>
  String(v ?? f)
    .replace(/[^\x20-\x7E]/g, "-")
    .slice(0, 200);

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = (body, status = 200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  body,
});

// <<< NUEVO: Normalizador robusto para evitar caracteres problemáticos
function normalizeText(s) {
  return String(s || "")
    // guiones unicode → guion normal
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    // espacios raros → espacio normal
    .replace(/\u00A0/g, " ")
    // comillas tipográficas
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    // puntos suspensivos tipográficos
    .replace(/\u2026/g, "...")
    // filtra fuera de ASCII visible + tab/CR/LF
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}

function asDataUrl({ imageB64, imageUrl }) {
  if (imageUrl && /^data:image\//i.test(imageUrl)) return imageUrl;
  if (imageUrl) return imageUrl; // URL remota
  if (!imageB64) return null;
  if (/^data:image\//i.test(imageB64)) return imageB64;
  // asumimos PNG si viene base64 "puro"
  return `data:image/png;base64,${imageB64}`;
}

// <<< NUEVO: pequeño backoff para errores transitorios
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOpenRouterVision({ model, prompt, dataUrl, temperature = 0.2 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const site = safeHeader(process.env.OPENROUTER_SITE_URL || "https://example.com");
  const app = safeHeader(process.env.OPENROUTER_APP_NAME || "Innova Space MIRA");

  const messages = [
    {
      role: "system",
      content:
        // Mantener español SIEMPRE y precisión
        "Eres un asistente de visión. Responde SIEMPRE en español de forma clara y precisa. " +
        "En OCR transcribe fiel al original sin comentarios; en 'describe' da detalles útiles y objetivos; " +
        "en 'qa' responde directo y conciso. Si no hay evidencia, dilo explícitamente.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt || "Describe la imagen con detalle en español." },
        { type: "image_url", image_url: dataUrl },
      ],
    },
  ];

  const body = { model, messages, temperature };

  // Hasta 2 reintentos en 429/5xx
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": site,
        "X-Title": app,
      },
      body: JSON.stringify(body),
    });

    const raw = await r.text();
    let data = {};
    try {
      data = JSON.parse(raw || "{}");
    } catch {}

    if (r.ok) {
      const content = data?.choices?.[0]?.message?.content?.trim?.() || "";
      return content;
    }

    const status = r.status;
    const msg = data?.error?.message || data?.error || raw || `HTTP ${status}`;
    // Si es error transitorio, reintenta con backoff
    if (status === 429 || (status >= 500 && status < 600)) {
      await sleep(400 * attempt);
      continue;
    }
    const err = new Error(msg);
    err.status = status;
    throw err;
  }

  throw new Error("OpenRouter no respondió después de varios intentos.");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: ORIGIN_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const task = String(body.task || "describe").toLowerCase();
  const question = (body.question || "").trim();
  const dataUrl = asDataUrl({ imageB64: body.imageB64, imageUrl: body.imageUrl });
  if (!dataUrl) return json({ error: "Falta la imagen (imageB64 o imageUrl)." }, 400);

  // Prompt según tarea
  let prompt = "Describe la imagen con detalle y contexto, sin inventar.";
  let temperature = 0.2;

  if (task === "ocr") {
    prompt =
      "Transcribe exactamente TODO el texto de la imagen (OCR). " +
      "Conserva mayúsculas, saltos de línea y símbolos; no agregues comentarios ni traducciones.";
    temperature = 0.0; // más determinista
  } else if (task === "qa") {
    prompt =
      `Responde con precisión a la siguiente pregunta sobre la imagen: ${question || "(sin pregunta)"}\n` +
      "Si la imagen no aporta evidencia suficiente, indícalo explícitamente.";
    temperature = 0.15;
  }

  // Prueba modelos válidos en orden
  let lastErr = null;
  for (const model of VALID_MODELS) {
    try {
      let content = await callOpenRouterVision({ model, prompt, dataUrl, temperature });
      if (!content) continue;

      // <<< NUEVO: limpieza ligera de envoltorios (bloques markdown)
      content = content.replace(/^```(?:\w+)?\s*/g, "").replace(/```$/g, "").trim();

      // <<< NUEVO: normaliza para evitar ByteString/Unicode fuera de rango
      const safe = normalizeText(content);

      return json({ content: safe });
    } catch (e) {
      lastErr = e;
      const m = String(e?.message || "");
      // modelo inválido: probar siguiente
      if (m.toLowerCase().includes("not a valid model")) continue;
      // otros errores: seguimos probando siguiente modelo
      continue;
    }
  }

  const hints = [
    "Usa JPG/PNG ≤ ~2 MB.",
    "Evita imágenes CMYK; usa RGB.",
    "Si falla un modelo, se intenta con otros automáticamente.",
  ];
  return json(
    {
      error: "Ningún modelo de visión aceptó la imagen.",
      detail: String(lastErr?.message || lastErr || "desconocido"),
      hints,
    },
    lastErr?.status || 400
  );
};

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
const safeHeader = (v, f="") => String(v ?? f).replace(/[^\x20-\x7E]/g, "-").slice(0, 200);

const json = (body, status=200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = (body, status=200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  body,
});

function asDataUrl({ imageB64, imageUrl }) {
  if (imageUrl && /^data:image\//i.test(imageUrl)) return imageUrl;
  if (imageUrl) return imageUrl; // URL remota
  if (!imageB64) return null;
  if (/^data:image\//i.test(imageB64)) return imageB64;
  // asumimos PNG si viene base64 "puro"
  return `data:image/png;base64,${imageB64}`;
}

async function callOpenRouterVision({ model, prompt, dataUrl }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const site = safeHeader(process.env.OPENROUTER_SITE_URL || "https://example.com");
  const app  = safeHeader(process.env.OPENROUTER_APP_NAME || "Innova Space MIRA");

  const messages = [
    { role: "system", content:
      "Eres un asistente de visión. Responde SIEMPRE en español. " +
      "Sé conciso y claro. En OCR transcribe fiel al original; en describe da detalles útiles; en QA responde directo." },
    { role: "user", content: [
        { type: "text", text: prompt || "Describe la imagen con detalle en español." },
        { type: "image_url", image_url: dataUrl }
      ]
    }
  ];

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": site,
      "X-Title": app,
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });

  const raw = await r.text();
  let data = {};
  try { data = JSON.parse(raw || "{}"); } catch {}

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || raw || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data?.choices?.[0]?.message?.content?.trim?.() || "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: ORIGIN_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json({ error: "JSON inválido" }, 400); }

  const task = (body.task || "describe").toLowerCase();
  const question = (body.question || "").trim();
  const dataUrl = asDataUrl({ imageB64: body.imageB64, imageUrl: body.imageUrl });
  if (!dataUrl) return json({ error: "Falta la imagen (imageB64 o imageUrl)." }, 400);

  let prompt = "Describe la imagen con detalle y contexto.";
  if (task === "ocr") prompt = "Transcribe exactamente todo el texto de la imagen (OCR). Conserva mayúsculas, saltos y símbolos.";
  else if (task === "qa") prompt = `Responde con precisión a la siguiente pregunta sobre la imagen: ${question || "(no se proporcionó pregunta)"}\nSi no hay suficiente evidencia visual, dilo explícitamente.`;

  // prueba modelos válidos en orden
  let lastErr = null;
  for (const model of VALID_MODELS) {
    try {
      const content = await callOpenRouterVision({ model, prompt, dataUrl });
      if (!content) continue;
      return json({ content });
    } catch (e) {
      lastErr = e;
      // model inválido → intenta con el siguiente
      if (String(e?.message||"").toLowerCase().includes("not a valid model")) continue;
    }
  }

  const hints = [
    "Usa JPG/PNG ≤ ~2 MB.",
    "Evita imágenes CMYK; usa RGB.",
    "Si falla un modelo, se intenta con otros automáticamente."
  ];
  return json({
    error: "Ningún modelo de visión aceptó la imagen.",
    detail: String(lastErr?.message || lastErr || "desconocido"),
    hints
  }, lastErr?.status || 400);
};

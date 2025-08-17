// netlify/functions/vision.js
// Caption de imágenes con Hugging Face Inference API
// Env requerida: HF_TOKEN
// Espera: { imageBase64: "data:image/...;base64,XXXX" }

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const MODELS = [
  "Salesforce/blip-image-captioning-base",   // 1) BLIP (rápido, bueno)
  "nlpconnect/vit-gpt2-image-captioning"     // 2) Fallback popular
];

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
});
const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", ...cors() },
  body: JSON.stringify(obj)
});

function parseCaptionPayload(data) {
  // BLIP → [{generated_text:"..."}]
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  // vit-gpt2 → [{"generated_text":"..."}] o {"generated_text":"..."}
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (data && typeof data.generated_text === "string") return data.generated_text;
  // Otros pipelines devuelven { "caption": "..." } o { "summary_text": "..." }
  if (data?.caption) return data.caption;
  if (data?.summary_text) return data.summary_text;
  return "";
}

async function callHF(model, buffer, tries = 3) {
  const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
  let lastTxt = "", lastStatus = 0;

  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer
    });

    lastStatus = r.status;
    if (r.ok) {
      const data = await r.json();
      const caption = parseCaptionPayload(data);
      if (caption) return { ok: true, caption, raw: data, model };
      return { ok: false, status: r.status, error: "Respuesta sin caption", raw: data, model };
    }

    // Lee texto de error (a veces sólo dice "Not Found")
    try { lastTxt = await r.text(); } catch { lastTxt = ""; }

    // Reintenta 429/5xx/408 (modelo dormido o rate limit)
    if (r.status === 429 || r.status === 408 || r.status >= 500) {
      await new Promise(res => setTimeout(res, 1200 * (i + 1)));
      continue;
    }
    break; // Para otros códigos (404/401/403), no tiene sentido reintentar
  }
  return { ok: false, status: lastStatus, error: lastTxt || "HF unknown error", model };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { imageBase64 } = JSON.parse(event.body || "{}");
    if (!imageBase64 || !imageBase64.includes(",")) return json({ error: "imageBase64 requerido" }, 400);

    if (!process.env.HF_TOKEN) {
      return json({ error: "Falta HF_TOKEN en variables de entorno Netlify." }, 500);
    }

    const base64 = imageBase64.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    // Intenta con varios modelos
    const errors = [];
    for (const m of MODELS) {
      const resp = await callHF(m, buffer, 3);
      if (resp.ok) return json({ ok: true, model: resp.model, caption: resp.caption, raw: resp.raw });
      errors.push({ model: m, status: resp.status, detail: resp.error });
      // Si es 401/403: token inválido o sin permisos → corta antes
      if (resp.status === 401 || resp.status === 403) break;
    }

    // Construye un mensaje claro para depurar
    let hint = "Revisa HF_TOKEN y nombre del modelo.";
    const has404 = errors.some(e => e.status === 404);
    const has401 = errors.some(e => e.status === 401);
    const has403 = errors.some(e => e.status === 403);
    if (has401) hint = "HF_TOKEN inválido o expirado (401).";
    else if (has403) hint = "El token no tiene permisos para este modelo (403).";
    else if (has404) hint = "Modelo no encontrado (404) o ruta incorrecta.";
    else if (errors.some(e => e.status >= 500)) hint = "Servicio HF con problemas (5xx); intenta de nuevo.";

    return json({
      error: "HF request failed",
      details: errors,
      hint
    }, 502);

  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

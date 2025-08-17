// netlify/functions/ocrspace.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const OCR_URL = "https://api.ocr.space/parse/image";

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Acepta { imageBase64: "data:image/...;base64,XXX" } o { imageUrl: "https://..." }
    const { imageBase64, imageUrl, language = "spa" } = JSON.parse(event.body || "{}");
    if (!imageBase64 && !imageUrl) return json({ error: "imageBase64 o imageUrl requerido" }, 400);

    const form = new URLSearchParams();
    form.append("language", language);
    form.append("isOverlayRequired", "false");
    form.append("scale", "true");
    form.append("OCREngine", "2");
    if (imageUrl) form.append("url", imageUrl);
    if (imageBase64) form.append("base64Image", imageBase64);

    const r = await fetch(OCR_URL, {
      method: "POST",
      headers: { apikey: process.env.OCR_SPACE_KEY },
      body: form
    });

    const data = await r.json();
    if (!r.ok || data?.IsErroredOnProcessing) {
      return json({ error: data?.ErrorMessage || data }, r.status || 500);
    }

    const text = data?.ParsedResults?.map(p => p.ParsedText).join("\n") || "";
    return json({ ok: true, text, raw: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; }
function json(payload, statusCode = 200) { return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(payload) }; }

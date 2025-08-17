// netlify/functions/ocrspace.js
// OCR con OCR.space
// Env requerida: OCRSPACE_API_KEY
// Espera: { imageBase64: "data:image/...;base64,XXXX", language?: "spa"|"eng"|... }

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const FormData = require("form-data");

const OCR_URL = "https://api.ocr.space/parse/image";

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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { imageBase64, language = "spa" } = JSON.parse(event.body || "{}");
    if (!imageBase64) return json({ error: "imageBase64 requerido" }, 400);

    const fd = new FormData();
    fd.append("base64Image", imageBase64);
    fd.append("language", language);
    fd.append("scale", "true");
    fd.append("isTable", "true");

    const r = await fetch(OCR_URL, {
      method: "POST",
      headers: { apikey: process.env.OCRSPACE_API_KEY },
      body: fd
    });

    const data = await r.json();
    if (!r.ok) return json({ error: "OCR call failed", details: data }, r.status);

    const text = data?.ParsedResults?.[0]?.ParsedText || "";
    return json({ ok: true, text, raw: data });
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

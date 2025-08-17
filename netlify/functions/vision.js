// netlify/functions/vision.js
// Caption de imágenes con BLIP (Hugging Face Inference API)
// Env requerida: HF_TOKEN
// Espera: { imageBase64: "data:image/...;base64,XXXX" }

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const HF_MODEL = "Salesforce/blip-image-captioning-base";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

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

async function hfFetchWithRetry(buffer, tries = 3) {
  let lastTxt = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(HF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer
    });
    if (r.ok) return { ok: true, data: await r.json() };
    lastTxt = await r.text();
    if (r.status === 429 || r.status >= 500 || r.status === 408) {
      await new Promise(res => setTimeout(res, 1200 * (i + 1)));
      continue;
    }
    return { ok: false, error: lastTxt, status: r.status };
  }
  return { ok: false, error: lastTxt };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { imageBase64 } = JSON.parse(event.body || "{}");
    if (!imageBase64 || !imageBase64.includes(",")) return json({ error: "imageBase64 requerido" }, 400);

    const base64 = imageBase64.split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const resp = await hfFetchWithRetry(buffer, 3);
    if (!resp.ok) return json({ error: "HF request failed", details: resp.error }, 502);

    const data = resp.data;
    // BLIP normalmente devuelve [{ generated_text: "..." }]
    const caption =
      (Array.isArray(data) && data[0] && data[0].generated_text) ? data[0].generated_text :
      (data?.generated_text || "");

    return json({ ok: true, caption, raw: data });
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

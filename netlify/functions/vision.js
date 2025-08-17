// netlify/functions/vision.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const HF_MODEL = "Salesforce/blip-image-captioning-base";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors(), body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Espera { imageBase64: "data:image/...;base64,XXXX" }
    const { imageBase64 } = JSON.parse(event.body || "{}");
    if (!imageBase64) return json({ error: "imageBase64 requerido" }, 400);

    const buffer = Buffer.from(imageBase64.split(',')[1] || "", "base64");
    const resp = await fetch(HF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer
    });

    const data = await resp.json();
    if (!resp.ok) return json({ error: data.error || data }, resp.status);

    // BLIP responde [{generated_text:"..."}] o similar
    const caption = Array.isArray(data) ? (data[0]?.generated_text || data[0]?.summary_text || "") : "";
    return json({ ok: true, caption, raw: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; }
function json(payload, statusCode = 200) { return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(payload) }; }

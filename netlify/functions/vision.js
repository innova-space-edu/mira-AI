// netlify/functions/vision.js
// Captioning clásico (BLIP / VIT-GPT2) con robustez y JSON garantizado
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const MODELS = [
  process.env.HF_VISION_MODEL || "Salesforce/blip-image-captioning-base",
  "nlpconnect/vit-gpt2-image-captioning",
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally { clearTimeout(t); }
}

async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt, nonJson: true }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { imageBase64, imageUrl } = JSON.parse(event.body || "{}");
    const image = imageBase64 || imageUrl;
    if (!image) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Falta imageBase64 o imageUrl" }) };

    if (!process.env.HF_TOKEN) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Falta HF_TOKEN" }) };
    }

    const errors = [];
    for (const model of MODELS) {
      const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}?wait_for_model=true`;

      // Estos modelos aceptan base64 (data URL) o URL http(s) en "inputs"
      const resp = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: image }),
      }, 25000);

      const data = await safeJson(resp);
      if (resp.ok) {
        // Formatos posibles: [{generated_text}], {generated_text}, {text}, {summary_text}
        const text =
          (Array.isArray(data) && data[0]?.generated_text) ||
          data.generated_text ||
          data.text ||
          data.summary_text ||
          "";

        if (text) {
          return { statusCode: 200, headers: cors(), body: JSON.stringify({ text: String(text).trim(), model }) };
        }
        // Ok pero sin texto — lograremos un retorno consistente
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ text: "", warning: "Respuesta sin texto utilizable", model, raw: data }) };
      }

      errors.push({ model, status: resp.status, detail: data?.error || data });
    }

    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: "HF request failed", details: errors }) };
  } catch (e) {
    const msg = e?.name === "AbortError" ? "timeout" : (e?.message || String(e));
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: msg }) };
  }
};

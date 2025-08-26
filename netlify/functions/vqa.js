// netlify/functions/vqa.js
// VQA multimodal con Qwen2-VL vía Hugging Face Inference API
// Vars esperadas en Netlify: HF_TOKEN (obligatoria), HF_VQA_MODEL (opcional)

const DEFAULT_MODEL = process.env.HF_VQA_MODEL || "Qwen/Qwen2-VL-7B-Instruct";

// CORS básico
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper: fetch con timeout usando AbortController
async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// Helper: parse seguro (nunca revienta si no es JSON)
async function safeJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt, nonJson: true }; }
}

// Normaliza varios formatos de salida posibles
function pickTextFromHF(data) {
  if (!data) return "";
  // Inference API a veces entrega array con {generated_text}
  if (Array.isArray(data)) {
    const t = data[0]?.generated_text || data[0]?.text || "";
    if (t) return String(t);
  }
  // O objeto con generated_text / text / output
  return String(
    data.generated_text ||
    data.text ||
    data.output ||
    data.raw || // de safeJson cuando no es JSON
    ""
  );
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    // Body: { imageBase64?: string, imageUrl?: string, prompt?: string, temperature?, max_new_tokens? }
    const body = JSON.parse(event.body || "{}");
    const { imageBase64, imageUrl, prompt, temperature = 0.2, max_new_tokens = 512 } = body || {};

    if (!process.env.HF_TOKEN) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Falta HF_TOKEN" }) };
    }
    if (!imageBase64 && !imageUrl) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Falta imageBase64 o imageUrl" }) };
    }

    const model = DEFAULT_MODEL;
    const HF_URL = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}?wait_for_model=true`;

    // Qwen2-VL espera formato “messages” con image_url
    const content = [
      { type: "text", text: prompt || "Describe la imagen y responde cualquier pregunta implícita." },
      imageBase64
        ? { type: "image_url", image_url: { url: imageBase64 } }
        : { type: "image_url", image_url: { url: imageUrl } },
    ];

    const payload = {
      inputs: [{ role: "user", content }],
      parameters: { temperature, max_new_tokens },
    };

    const resp = await fetchWithTimeout(HF_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 25000);

    const data = await safeJson(resp);

    if (!resp.ok) {
      // Devuelve SIEMPRE JSON con detalle del fallo
      return {
        statusCode: resp.status || 502,
        headers: CORS,
        body: JSON.stringify({ error: "HF request failed", model, details: data }),
      };
    }

    const text = pickTextFromHF(data).trim();
    if (!text) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ text: "", warning: "Respuesta sin texto utilizable", model, raw: data }),
      };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ text, model }) };
  } catch (err) {
    // Errores de parseo, abort, etc.
    const msg = err?.name === "AbortError" ? "timeout" : (err?.message || String(err));
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};

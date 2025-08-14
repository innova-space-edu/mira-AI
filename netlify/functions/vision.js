// Netlify Function unificada: /api/vision
// Modos:
//  - caption: BLIP image captioning (binario)
//  - vqa    : Visual Question Answering (ViLT) con pregunta
//
// Env requerida: HF_TOKEN
// Body esperado (JSON):
//  { "mode": "caption" | "vqa", "image_base64": "<BASE64>", "question"?: "..." }

const HF_MODELS = {
  caption: "Salesforce/blip-image-captioning-base",
  vqa: "dandelin/vilt-b32-finetuned-vqa",
};

const ALLOWED_ORIGIN = "*";

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ----- Retries -----
async function hfFetchBinary(model, buffer, tries = 3) {
  const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer,
    });
    if (r.ok) return { ok: true, data: await r.json() };
    last = await r.text();
    if (r.status >= 500 || r.status === 429 || r.status === 408) { await delay(1200 * (i + 1)); continue; }
    return { ok: false, status: r.status, detail: last };
  }
  return { ok: false, status: 503, detail: last || "Modelo no disponible (timeout/retries)" };
}

async function hfFetchJSON(model, payload, tries = 3) {
  const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true, data: await r.json() };
    last = await r.text();
    if (r.status >= 500 || r.status === 429 || r.status === 408) { await delay(1200 * (i + 1)); continue; }
    return { ok: false, status: r.status, detail: last };
  }
  return { ok: false, status: 503, detail: last || "Modelo no disponible (timeout/retries)" };
}

// ----- Helper: aceptar dataURL o base64 "puro" -----
function stripDataURL(s) {
  if (!s) return s;
  const i = s.indexOf(",");
  return i >= 0 ? s.slice(i + 1) : s;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!process.env.HF_TOKEN) {
      return { statusCode: 500, body: "Falta HF_TOKEN en variables de entorno." };
    }

    const qpMode = event.queryStringParameters?.mode;
    const { mode = qpMode || "caption", image_base64, question = "Describe la imagen brevemente." } =
      JSON.parse(event.body || "{}");

    if (!image_base64) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        body: JSON.stringify({ error: "Falta image_base64" }),
      };
    }

    if (mode === "caption") {
      const raw = stripDataURL(image_base64);
      const buffer = Buffer.from(raw, "base64");
      const result = await hfFetchBinary(HF_MODELS.caption, buffer, 3);

      if (!result.ok) {
        return {
          statusCode: result.status || 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
          body: JSON.stringify({ error: "HF caption error", detail: result.detail }),
        };
      }

      const out = result.data;
      const caption = Array.isArray(out)
        ? (out[0]?.generated_text || "")
        : (out?.generated_text || JSON.stringify(out));

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        body: JSON.stringify({ mode: "caption", caption }),
      };
    }

    // --- VQA ---
    const payload = { inputs: { question, image: stripDataURL(image_base64) } };
    const result = await hfFetchJSON(HF_MODELS.vqa, payload, 3);

    if (!result.ok) {
      return {
        statusCode: result.status || 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        body: JSON.stringify({ error: "HF VQA error", detail: result.detail }),
      };
    }

    const out = result.data;
    const answer = Array.isArray(out)
      ? (out[0]?.answer || JSON.stringify(out[0] || out))
      : (out?.answer || JSON.stringify(out));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      body: JSON.stringify({ mode: "vqa", answer }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      body: JSON.stringify({ error: "vision function failed", detail: String(e) }),
    };
  }
};

// Function unificada: /api/vision
// Modos:
//   - caption → BLIP image captioning (binario)
//   - vqa     → Visual Question Answering (ViLT)
// Env requerida: HF_TOKEN
//
// Body (JSON):
// { "mode": "caption" | "vqa", "image_base64": "<b64|dataURL>", "question"?: "..." }

const HF_MODELS = {
  caption: "Salesforce/blip-image-captioning-base",
  vqa: "dandelin/vilt-b32-finetuned-vqa"
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type"
  };
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// Acepta base64 "puro" o dataURL y devuelve solo la parte base64
function stripDataURL(s) {
  if (!s) return s;
  const i = s.indexOf(",");
  return i >= 0 ? s.slice(i + 1) : s;
}

async function hfFetchBinary(model, buffer, tries = 3) {
  const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
  let last = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (r.ok) return { ok: true, data: await r.json() };
    last = await r.text();
    if (r.status >= 500 || r.status === 429 || r.status === 408) { await delay(1200 * (i + 1)); continue; }
    return { ok: false, status: r.status, detail: last };
  }
  return { ok: false, status: 503, detail: last || "Modelo no disponible (timeout/retries)" };
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }

    if (!process.env.HF_TOKEN) {
      return { statusCode: 500, headers: cors(), body: "Falta HF_TOKEN en variables de entorno." };
    }

    const qsMode = event.queryStringParameters && event.queryStringParameters.mode;
    const body = JSON.parse(event.body || "{}");

    // Admitimos ambas claves: image_base64 o imageBase64
    const rawImage =
      body.image_base64 || body.imageBase64 || body.image || null;

    const mode = (body.mode || qsMode || "caption").toLowerCase();
    const question = body.question || "Describe la imagen brevemente.";

    if (!rawImage) {
      return {
        statusCode: 400,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Falta image_base64" })
      };
    }

    if (mode === "caption") {
      const b64 = stripDataURL(rawImage);
      const buffer = Buffer.from(b64, "base64");
      const result = await hfFetchBinary(HF_MODELS.caption, buffer, 3);

      if (!result.ok) {
        return {
          statusCode: result.status || 500,
          headers: { ...cors(), "Content-Type": "application/json" },
          body: JSON.stringify({ error: "HF caption error", detail: result.detail })
        };
      }

      const out = result.data;
      const caption = Array.isArray(out)
        ? (out[0]?.generated_text || "")
        : (out?.generated_text || JSON.stringify(out));

      return {
        statusCode: 200,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "caption", caption })
      };
    }

    // --- VQA ---
    const payload = { inputs: { question, image: stripDataURL(rawImage) } };
    const result = await hfFetchJSON(HF_MODELS.vqa, payload, 3);

    if (!result.ok) {
      return {
        statusCode: result.status || 500,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "HF VQA error", detail: result.detail })
      };
    }

    const out = result.data;
    const answer = Array.isArray(out)
      ? (out[0]?.answer || JSON.stringify(out[0] || out))
      : (out?.answer || JSON.stringify(out));

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "vqa", answer })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "vision function failed", detail: String(err && err.message || err) })
    };
  }
};

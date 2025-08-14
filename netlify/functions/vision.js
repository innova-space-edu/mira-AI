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
  return { ok: false, status: 5

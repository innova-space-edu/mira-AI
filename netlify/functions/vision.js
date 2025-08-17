// netlify/functions/vision.js
// Proxy a Hugging Face Inference API para captioning (visión)
// Requiere: process.env.HF_TOKEN
// Por defecto usa: Salesforce/blip-image-captioning-base
// Acepta body JSON:
//   { imageBase64: "data:image/...;base64,XXXX" }  ó  { imageUrl: "https://..." }
//   Opcionales:
//     - model: string (p.ej. "Salesforce/blip-image-captioning-large")
//     - wait_for_model: boolean (default true)
//     - timeout_ms: number (timeout de fetch)
// Respuesta: { ok: true, caption, raw, model }

let _fetch = globalThis.fetch;
async function getFetch() {
  if (_fetch) return _fetch;
  const { default: f } = await import('node-fetch'); // fallback si no hay fetch nativo
  _fetch = f;
  return _fetch;
}

const DEFAULT_MODEL = "Salesforce/blip-image-captioning-base";

function buildHfUrl(model, waitForModel = true) {
  const base = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  return waitForModel ? `${base}?wait_for_model=true` : base;
}

// ----------------- Helpers -----------------
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(payload, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors(), ...extraHeaders },
    body: JSON.stringify(payload)
  };
}

function text(body, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...cors(), ...extraHeaders },
    body
  };
}

function parseDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const m = /^data:(?<mime>[^;]+);base64,(?<data>.+)$/i.exec(dataUrl || "");
  if (!m || !m.groups) return null;
  return { mime: m.groups.mime, b64: m.groups.data };
}

function normalizeBase64(input, fallbackMime = "image/jpeg") {
  if (!input) return null;
  if (/^data:.*;base64,/.test(input)) return input; // ya es dataURL
  // si es base64 "crudo", lo envolvemos
  return `data:${fallbackMime};base64,${input}`;
}

// ----------------- Handler -----------------
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const HF_TOKEN = process.env.HF_TOKEN;
    if (!HF_TOKEN) {
      return text('Falta HF_TOKEN en variables de entorno.', 500);
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return text('JSON inválido en el body.', 400);
    }

    const imageBase64Raw = body.imageBase64 ?? body.image_base64 ?? null;
    const imageUrl = body.imageUrl ?? body.image_url ?? null;
    const model = body.model || DEFAULT_MODEL;
    const wait_for_model = body.wait_for_model !== undefined ? !!body.wait_for_model : true;
    const timeout_ms = Number(body.timeout_ms ?? 60_000); // 60s por defecto

    if (!imageBase64Raw && !imageUrl) {
      return json({ error: "imageBase64 (o image_base64) o imageUrl (o image_url) requerido" }, 400);
    }

    // Normalizamos a dataURL si vino base64 "crudo"
    const imageBase64 = imageBase64Raw ? normalizeBase64(imageBase64Raw) : null;

    // Tamaño prudente (evitar payloads gigantes)
    const approxSize = (imageBase64 || "").length + (imageUrl || "").length;
    if (approxSize > 8_000_000) { // ~8MB en string
      return text("Imagen demasiado grande. Reduce resolución o peso.", 413);
    }

    const f = await getFetch();

    // Si nos pasan imageUrl, usamos la API de HF vía "inputs" con URL remota.
    // Si nos pasan base64, enviamos el binario directo (más eficiente).
    const hfUrl = buildHfUrl(model, wait_for_model);

    let hfResp;
    if (imageUrl) {
      // Modo "inputs" (JSON), HF descargará la imagen desde esa URL
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), Math.max(1_000, timeout_ms));
      try {
        hfResp = await f(hfUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ inputs: imageUrl }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(to);
      }
    } else {
      // Modo binario: extraemos el buffer del dataURL
      const parsed = parseDataUrl(imageBase64);
      if (!parsed) return json({ error: "imageBase64 no es un dataURL válido" }, 400);
      const buffer = Buffer.from(parsed.b64, "base64");

      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), Math.max(1_000, timeout_ms));
      try {
        hfResp = await f(hfUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${HF_TOKEN}` },
          body: buffer,
          signal: controller.signal
        });
      } finally {
        clearTimeout(to);
      }
    }

    const textResp = await hfResp.text();
    let data;
    try { data = JSON.parse(textResp); } catch { data = null; }

    if (!hfResp.ok) {
      // Errores típicos de HF: { error: "Model Salesforce/... is currently loading", estimated_time: ...}
      return json({ error: (data && (data.error || data)) || textResp || "HF error" }, hfResp.status);
    }

    // BLIP suele responder como array con { generated_text } (o summary_text)
    let caption = "";
    if (Array.isArray(data) && data.length) {
      const first = data[0] || {};
      caption = first.generated_text || first.summary_text || "";
    } else if (data && typeof data === "object") {
      // Por si el modelo devolviera otro formato compatible
      caption = data.generated_text || data.summary_text || "";
    }

    // Aseguramos string
    caption = String(caption || "").trim();

    return json({ ok: true, caption, raw: data, model });
  } catch (e) {
    const detail = (e && e.message) ? String(e.message) : String(e);
    return json({ error: "vision proxy failed", detail }, 500);
  }
};

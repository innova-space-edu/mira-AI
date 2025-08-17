// netlify/functions/ocrspace.js
// Proxy a OCR.Space
// Requiere: process.env.OCR_SPACE_KEY
// Doc OCR.Space: https://ocr.space/OCRAPI
// Acepta en el body (JSON):
//   { imageBase64 | image_base64: "data:image/...;base64,XXX" }
//   ó { imageUrl | image_url: "https://..." }
//   Opcionales:
//   { language="spa", isTable=false, detectOrientation=true, isOverlayRequired=false, OCREngine=2, scale=true }
//   (también soporta "filetype" como "PNG", "JPG", etc. si usas base64 sin dataURL)

let _fetch = globalThis.fetch;
async function getFetch() {
  if (_fetch) return _fetch;
  const { default: f } = await import('node-fetch'); // fallback si el runtime no trae fetch
  _fetch = f;
  return _fetch;
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

// Normaliza dataURL: si te pasan base64 "crudo", lo convertimos a data:image/jpeg;base64,...
function ensureDataUrl(b64, filetype) {
  if (!b64) return null;
  if (/^data:.*;base64,/.test(b64)) return b64;
  const ft = (filetype || "jpeg").toLowerCase().replace(/^image\//, "");
  return `data:image/${ft};base64,${b64}`;
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
    const apiKey = process.env.OCR_SPACE_KEY;
    if (!apiKey) {
      return text('Falta OCR_SPACE_KEY en variables de entorno.', 500);
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return text('JSON inválido en el body.', 400);
    }

    // Soportamos ambas variantes de nombres de clave (camelCase y snake_case)
    const imageBase64Raw = body.imageBase64 ?? body.image_base64 ?? null;
    const imageUrl = body.imageUrl ?? body.image_url ?? null;

    // Parámetros opcionales con defaults sensatos
    const language = body.language ?? "spa";
    const isOverlayRequired = Boolean(body.isOverlayRequired ?? false);
    const isTable = Boolean(body.isTable ?? false);
    const detectOrientation = Boolean(body.detectOrientation ?? true);
    const scale = Boolean(body.scale ?? true);
    const OCREngine = Number(body.OCREngine ?? 2); // 1=engine antiguo, 2=nuevo
    const filetype = body.filetype; // "PNG" | "JPG" | "GIF" | "PDF" | etc.

    if (!imageBase64Raw && !imageUrl) {
      return json({ error: "imageBase64 (o image_base64) o imageUrl (o image_url) requerido" }, 400);
    }

    // Si viene base64 "crudo" sin dataURL lo normalizamos
    const imageBase64 = ensureDataUrl(imageBase64Raw, filetype);

    // Tamaño prudente para evitar requests gigantes accidentales
    const approxSize = (imageBase64 || "").length + (imageUrl || "").length;
    if (approxSize > 8_000_000) { // ~8MB de string
      return text("Imagen demasiado grande para OCR (reduce resolución/peso).", 413);
    }

    // Construimos el form (application/x-www-form-urlencoded)
    const form = new URLSearchParams();
    form.append("language", language);
    form.append("isOverlayRequired", String(isOverlayRequired));
    form.append("isTable", String(isTable));
    form.append("detectOrientation", String(detectOrientation));
    form.append("scale", String(scale));
    form.append("OCREngine", String(OCREngine));

    if (imageUrl) form.append("url", imageUrl);
    if (imageBase64) form.append("base64Image", imageBase64);
    if (filetype) form.append("filetype", String(filetype).toUpperCase());

    // Request a OCR.Space
    const f = await getFetch();
    const r = await f("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: apiKey },
      body: form
    });

    const textResp = await r.text();
    let data;
    try { data = JSON.parse(textResp); } catch { data = null; }

    // Manejo de errores de OCR.Space
    if (!r.ok) {
      return json({ error: (data && (data.error || data)) || textResp || "OCR error" }, r.status);
    }
    if (!data || data.IsErroredOnProcessing) {
      const errMsg = data?.ErrorMessage || data?.ErrorMessageDetail || "IsErroredOnProcessing";
      return json({ error: errMsg, raw: data }, 502);
    }

    const results = Array.isArray(data?.ParsedResults) ? data.ParsedResults : [];
    const textOut = results.map(p => p?.ParsedText || "").join("\n");

    // Información útil adicional (si existe)
    const processingTime = data?.ProcessingTimeInMilliseconds;
    const meanConfidence = (() => {
      // OCR.Space a veces entrega TextOverlay.Lines[].Words[].Confidence
      try {
        const lines = results.flatMap(pr => pr?.TextOverlay?.Lines || []);
        const words = lines.flatMap(l => l?.Words || []);
        const confs = words.map(w => Number(w?.WordConfidence)).filter(n => Number.isFinite(n));
        if (!confs.length) return undefined;
        const avg = confs.reduce((a,b)=>a+b,0) / confs.length;
        return Math.round(avg * 10) / 10;
      } catch { return undefined; }
    })();

    return json({
      ok: true,
      text: (textOut || "").trim(),
      meta: {
        processingTimeMs: processingTime,
        meanConfidence
      },
      raw: data
    });
  } catch (e) {
    const detail = (e && e.message) ? String(e.message) : String(e);
    return json({ error: "ocrspace proxy failed", detail }, 500);
  }
};

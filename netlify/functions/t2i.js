// netlify/functions/t2i.js
// POST /api/t2i
// Body: { prompt, negative_prompt?, options?: { aspect_ratio?, guidance?, seed?, safety? }, provider? }
// Usa T2I_PROVIDER_URL (+ T2I_API_KEY opcional) para delegar la generación.
// Mantiene funciones existentes (cors, json, text) y añade robustez (retry, normalización de salida).

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization"
  };
}
function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(res)
  };
}
function text(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
    body
  };
}

// --- Config ---
const PROVIDER_URL = process.env.T2I_PROVIDER_URL || "";  // ej: http://localhost:3002/t2i
const PROVIDER_KEY = process.env.T2I_API_KEY || "";

// Normalización ligera por si el proveedor devuelve texto con unicode "raro"
function normalizeStr(s = "") {
  return String(s)
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  if (!PROVIDER_URL) return json({ error: "T2I_PROVIDER_URL no configurado" }, 500);

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const {
    prompt,
    negative_prompt = "",
    options = {},
    provider = "auto"
  } = body;

  if (!prompt || typeof prompt !== "string") {
    return json({ error: "prompt requerido" }, 400);
  }

  // Payload limpio y con defaults sensatos
  const payload = {
    prompt,
    negative_prompt,
    options: {
      aspect_ratio: options.aspect_ratio || "1:1",
      guidance: typeof options.guidance === "number" ? options.guidance : 6.5,
      seed: typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 1e9),
      safety: options.safety || "strict"
    },
    provider
  };

  // Hasta 2 reintentos con backoff si hay 429/5xx del proveedor
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    try {
      const resp = await fetch(PROVIDER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PROVIDER_KEY ? { "Authorization": `Bearer ${PROVIDER_KEY}` } : {})
        },
        body: JSON.stringify(payload)
      });

      // Si el proveedor retorna binario (imagen directa)
      const ct = resp.headers.get("content-type") || "";
      if (resp.ok && /^image\//i.test(ct)) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const b64 = buf.toString("base64");
        const mime = ct.split(";")[0] || "image/png";
        return json({ imageB64: b64, mime });
      }

      const raw = await resp.text();
      let data = {};
      try { data = JSON.parse(raw); } catch { data = {}; }

      if (!resp.ok) {
        const detail = (data && (data.error || data.detail)) || raw?.slice(0, 400);
        // Reintentos en 429/5xx
        if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
          await sleep(400 * attempt);
          continue;
        }
        return json({ error: `Proveedor T2I falló: ${resp.status} ${resp.statusText}`, detail }, 502);
      }

      // Normalizamos convenciones típicas de respuesta
      // Acepta: { imageUrl }, { image }, { imageB64 }, { data: {url|b64}}, etc.
      const imageUrl =
        data.imageUrl ||
        data.url ||
        data.data?.url ||
        null;

      const imageB64 =
        data.imageB64 ||
        data.b64 ||
        data.data?.b64 ||
        null;

      const image =
    data.image || null; // a veces devuelven data:image/png;base64,...

      if (imageUrl || imageB64 || image) {
        return json({
          imageUrl: imageUrl || undefined,
          imageB64: imageB64 || (image && image.startsWith("data:image/") ? image.split(",")[1] : undefined),
          image: image || undefined
        });
      }

      // Si el proveedor devuelve otra estructura, la pasamos tal cual
      return json(data);

    } catch (e) {
      // Error de red o excepción — reintenta si aún quedan
      if (attempt < 3) {
        await sleep(400 * attempt);
        continue;
      }
      return json({ error: "Excepción T2I", detail: normalizeStr(String(e?.message || e)) }, 500);
    }
  }

  return json({ error: "Proveedor T2I no respondió tras varios intentos" }, 504);
};

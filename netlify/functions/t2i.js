// netlify/functions/t2i.js
// Body: { prompt, negative_prompt?, options?: { aspect_ratio?, guidance?, seed?, safety? }, provider? }
//
// Comportamiento:
// - Si T2I_PROVIDER_URL está definido → usa ese proveedor propio.
// - Si NO está definido → fallback automático a OpenRouter Images (requiere OPENROUTER_API_KEY).
//
// También soporta respuestas binaria/imageB64/imageUrl y normaliza strings.

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
}
function json(res, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(res) };
}
function text(body, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" }, body };
}

// --- Config ---
const PROVIDER_URL = process.env.T2I_PROVIDER_URL || "";  // si está, se usa este
const PROVIDER_KEY = process.env.T2I_API_KEY || "";

// Fallback a OpenRouter Images si no hay PROVIDER_URL
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const T2I_MODEL = process.env.T2I_MODEL || "black-forest-labs/flux-1-dev";
const OPENROUTER_SITE = (process.env.OPENROUTER_SITE_URL || "https://example.com").slice(0, 200);
const OPENROUTER_APP  = (process.env.OPENROUTER_APP_NAME || "Innova Space MIRA").slice(0, 200);

// Utilidades
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function normalizeStr(s = "") {
  return String(s)
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}

// --- Cliente genérico a tu proveedor propio ---
async function callExternalProvider(payload) {
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    const resp = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(PROVIDER_KEY ? { Authorization: `Bearer ${PROVIDER_KEY}` } : {}) },
      body: JSON.stringify(payload),
    });

    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && /^image\//i.test(ct)) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return { imageB64: buf.toString("base64") };
    }

    const raw = await resp.text();
    let data = {}; try { data = JSON.parse(raw); } catch {}

    if (!resp.ok) {
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) { await sleep(400 * attempt); continue; }
      throw new Error(`Proveedor T2I falló: ${resp.status} ${resp.statusText} – ${raw?.slice(0, 400)}`);
    }
    // Acepta varios formatos
    return {
      imageUrl: data.imageUrl || data.url || data.data?.url || undefined,
      imageB64: data.imageB64 || data.b64 || data.data?.b64 || (data.image && data.image.startsWith("data:image/") ? data.image.split(",")[1] : undefined),
      image: data.image,
      _raw: data,
    };
  }
  throw new Error("Proveedor T2I no respondió tras varios intentos.");
}

// --- Fallback OpenRouter /v1/images ---
async function callOpenRouterImages({ prompt, negative_prompt, options }) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY no configurada para fallback T2I.");

  // Tamaño según aspect_ratio
  const ar = String(options?.aspect_ratio || "1:1");
  let size = "1024x1024";
  if (ar === "16:9") size = "1280x720";
  else if (ar === "3:4") size = "1024x1365";
  else if (ar === "9:16") size = "864x1536";

  const body = {
    model: T2I_MODEL,
    prompt,
    negative_prompt: negative_prompt || "",
    size
  };

  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    const r = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_SITE,
        "X-Title": OPENROUTER_APP,
      },
      body: JSON.stringify(body),
    });

    const raw = await r.text();
    let data = {}; try { data = JSON.parse(raw || "{}"); } catch {}

    if (r.ok) {
      const first = Array.isArray(data?.data) ? data.data[0] : null;
      const imageB64 = first?.b64_json || null;
      const imageUrl = first?.url || null;
      if (!imageB64 && !imageUrl) throw new Error("Respuesta de Images sin datos de imagen.");
      return { imageB64, imageUrl, _raw: data };
    }

    if (r.status === 429 || (r.status >= 500 && r.status < 600)) { await sleep(400 * attempt); continue; }
    throw new Error(`OpenRouter Images falló: ${r.status} ${r.statusText} – ${raw?.slice(0, 400)}`);
  }
  throw new Error("OpenRouter Images no respondió tras varios intentos.");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return text("Method Not Allowed", 405);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json({ error: "JSON inválido" }, 400); }

  const { prompt, negative_prompt = "", options = {}, provider = "auto" } = body;
  if (!prompt || typeof prompt !== "string") return json({ error: "prompt requerido" }, 400);

  const payload = {
    prompt,
    negative_prompt,
    options: {
      aspect_ratio: options.aspect_ratio || "1:1",
      guidance: typeof options.guidance === "number" ? options.guidance : 6.5,
      seed: typeof options.seed === "number" ? options.seed : Math.floor(Math.random() * 1e9),
      safety: options.safety || "strict",
    },
    provider,
  };

  try {
    if (PROVIDER_URL) {
      const data = await callExternalProvider(payload);
      if (data?.imageUrl || data?.imageB64 || data?.image) return json(data, 200);
      return json({ error: "Respuesta T2I sin imagen", detail: data?._raw }, 502);
    }
    const fb = await callOpenRouterImages({ prompt, negative_prompt, options: payload.options });
    return json(fb, 200);
  } catch (e) {
    return json({ error: "T2I error", detail: normalizeStr(String(e?.message || e)) }, 500);
  }
};

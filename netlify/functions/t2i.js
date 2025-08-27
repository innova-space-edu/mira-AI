// netlify/functions/t2i.js
// POST /api/t2i  { prompt, negative_prompt?, options?: { aspect_ratio?, guidance?, seed?, safety? }, provider? }

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization"
  };
}
function json(res, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(res) };
}
function text(body, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" }, body };
}

const PROVIDER_URL = process.env.T2I_PROVIDER_URL || "";  // ej: http://localhost:3002/t2i  ó  https://api.tu-proveedor.com/t2i
const PROVIDER_KEY = process.env.T2I_API_KEY || "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return text("Method Not Allowed", 405);

  if (!PROVIDER_URL) return json({ error: "T2I_PROVIDER_URL no configurado" }, 500);

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
      seed: typeof options.seed === "number" ? options.seed : Math.floor(Math.random()*1e9),
      safety: options.safety || "strict"
    },
    provider
  };

  try {
    const resp = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PROVIDER_KEY ? { "Authorization": `Bearer ${PROVIDER_KEY}` } : {})
      },
      body: JSON.stringify(payload)
    });
    const raw = await resp.text();
    if (!resp.ok) return json({ error: `Proveedor T2I falló: ${resp.status} ${resp.statusText}`, detail: raw?.slice(0,400) }, 502);

    // Normalizamos respuesta del proveedor
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    // Aceptamos: { imageUrl }, { image }, { imageB64 }, etc.
    if (data.imageUrl || data.image || data.imageB64) return json(data, 200);

    // Si el proveedor devolvió binario (PNG/JPEG), lo convertimos a base64
    if (!data || Object.keys(data).length === 0) {
      // fallback: asume binario
      const b64 = Buffer.from(raw, "binary").toString("base64");
      return json({ imageB64: b64 }, 200);
    }

    return json(data, 200);
  } catch (e) {
    return json({ error: "Excepción T2I", detail: String(e?.message || e) }, 500);
  }
};

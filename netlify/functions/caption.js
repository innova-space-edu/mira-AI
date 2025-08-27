// netlify/functions/caption.js
// Image -> Text (caption) usando Salesforce/blip-image-captioning-base
export default async function handler(request) {
  // CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors() });
  }

  const HF_API_KEY = process.env.HF_API_KEY;
  const MODEL = process.env.HF_CAPTION_MODEL || "Salesforce/blip-image-captioning-base";
  if (!HF_API_KEY) {
    return Response.json({ error: "Falta HF_API_KEY en variables de entorno." }, { status: 401, headers: cors() });
  }

  try {
    // Esperamos multipart/form-data con campo "image"
    const form = await request.formData();
    const file = form.get("image");
    if (!file) {
      return Response.json({ error: "Falta archivo 'image' (multipart/form-data)." }, { status: 400, headers: cors() });
    }

    const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(MODEL)}`;

    // Hasta 2 reintentos si el modelo está “cargando” (503 con estimated_time)
    const maxRetries = 2;
    let lastJson = null;

    for (let i = 0; i <= maxRetries; i++) {
      const hfResp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          Accept: "application/json",
          "Content-Type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      });

      const isJson = (hfResp.headers.get("content-type") || "").includes("application/json");
      const payload = isJson ? await hfResp.json() : null;

      if (hfResp.ok && Array.isArray(payload)) {
        const text =
          payload[0]?.generated_text ||
          payload[0]?.caption ||
          "";
        return Response.json({ text }, { headers: cors() });
      }

      // 503: modelo cargando
      if (hfResp.status === 503 && payload?.estimated_time && i < maxRetries) {
        await sleep(Math.min(1500 + i * 1000, 4000));
        lastJson = payload;
        continue;
      }

      // Otro error HF
      return new Response(JSON.stringify(payload || { error: "HF request failed" }), {
        status: hfResp.status,
        headers: { ...cors(), "Content-Type": "application/json" },
      });
    }

    // Si salimos del bucle sin éxito
    return Response.json({ error: "Modelo ocupado/cargando", details: lastJson || null }, { status: 502, headers: cors() });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500, headers: cors() });
  }
}

/* ===== Helpers ===== */
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

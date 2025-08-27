// netlify/functions/caption.js
// Image -> Text con fallback: BLIP base → BLIP large → ViT-GPT2
export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors() });

  const HF_API_KEY = process.env.HF_API_KEY;
  if (!HF_API_KEY) return Response.json({ error: "Falta HF_API_KEY" }, { status: 401, headers: cors() });

  // Permite override por env, y si falla, probamos otras dos opciones conocidas
  const models = [
    process.env.HF_CAPTION_MODEL,
    "Salesforce/blip-image-captioning-base",
    "Salesforce/blip-image-captioning-large",
    "nlpconnect/vit-gpt2-image-captioning",
  ].filter(Boolean);

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!file) return Response.json({ error: "Falta archivo 'image' (multipart/form-data)" }, { status: 400, headers: cors() });

    const buf = await file.arrayBuffer();

    let lastErr = null;
    for (const model of models) {
      const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;

      // Hasta 2 reintentos si está “loading” (503)
      for (let i = 0; i < 3; i++) {
        const hf = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            Accept: "application/json",
            "Content-Type": "application/octet-stream",
          },
          body: buf,
        });

        const ct = hf.headers.get("content-type") || "";
        const isJson = ct.includes("application/json");
        const payload = isJson ? await hf.json() : null;

        if (hf.ok && Array.isArray(payload)) {
          const text = payload[0]?.generated_text || payload[0]?.caption || "";
          if (text) return Response.json({ text, model }, { headers: cors() });
          lastErr = { status: 502, details: "Respuesta sin texto" };
          break;
        }

        if (hf.status === 503 && payload?.estimated_time) {
          await sleep(1200 + i * 800);
          continue; // retry
        }

        // 404 → probamos el siguiente modelo del fallback
        if (hf.status === 404) { lastErr = { status: 404, details: payload }; break; }

        // Otro error → devolvemos detalle para depurar
        return new Response(JSON.stringify(payload || { error: "HF request failed" }), {
          status: hf.status,
          headers: { ...cors(), "Content-Type": "application/json" },
        });
      }
    }

    return Response.json({ error: "Todos los modelos fallaron", details: lastErr }, { status: 502, headers: cors() });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500, headers: cors() });
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

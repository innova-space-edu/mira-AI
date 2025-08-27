// netlify/functions/caption.js
// Devuelve una descripción de la imagen usando varios modelos de HuggingFace.
// Si un modelo devuelve 404 o 503, pasa al siguiente.
export default async function handler(request) {
  // Responder a preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors() });
  }

  const HF_API_KEY = process.env.HF_API_KEY;
  if (!HF_API_KEY) {
    return Response.json({ error: "Falta HF_API_KEY" }, { status: 401, headers: cors() });
  }

  // Modelos a probar (el primero puede venir de HF_CAPTION_MODEL si lo defines en Netlify).
  const models = [
    process.env.HF_CAPTION_MODEL,
    "Salesforce/blip-image-captioning-base",
    "Salesforce/blip-image-captioning-large",
    "nlpconnect/vit-gpt2-image-captioning",
  ].filter(Boolean);

  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!file) {
      return Response.json({ error: "Falta archivo 'image' (multipart/form-data)" }, { status: 400, headers: cors() });
    }
    // Codificamos la imagen en base64 para la API JSON
    const buf = await file.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");

    let lastErr = null;
    for (const model of models) {
      const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
      // Usamos formato JSON, que es más robusto que octet-stream
      const payload = {
        inputs: `data:image/${file.name.split('.').pop() || 'jpeg'};base64,${b64}`,
        options: { wait_for_model: true },
      };

      for (let retry = 0; retry < 3; retry++) {
        const hf = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const isJson = (hf.headers.get("content-type") || "").includes("application/json");
        const data = isJson ? await hf.json() : null;

        if (hf.ok && data) {
          const text =
            data?.generated_text ||
            data?.caption ||
            (Array.isArray(data) ? data[0]?.generated_text : "") ||
            "";
          if (text) {
            return Response.json({ text: text.trim(), model }, { headers: cors() });
          }
          lastErr = { status: hf.status, details: data };
          break; // pasa al siguiente modelo
        }

        // 503: el modelo está arrancando. Esperamos un poco y reintentamos.
        if (hf.status === 503 && data?.estimated_time && retry < 2) {
          await new Promise(r => setTimeout(r, 1500 + retry * 800));
          continue;
        }
        // 404: modelo no accesible → probamos el siguiente.
        if (hf.status === 404) {
          lastErr = { status: 404, details: data };
          break;
        }
        // Otro error → devolvemos respuesta para depurar.
        return new Response(JSON.stringify(data || { error: "HF request failed" }), {
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

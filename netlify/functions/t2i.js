// netlify/functions/t2i.js
// Text -> Image usando Hugging Face FLUX.1-schnell
export default async function handler(request) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors() });
  }

  try {
    const HF_API_KEY = process.env.HF_API_KEY;
    const MODEL = process.env.HF_T2I_MODEL || "black-forest-labs/FLUX.1-schnell";
    if (!HF_API_KEY) {
      return Response.json({ error: "Falta HF_API_KEY en variables de entorno." }, { status: 401, headers: cors() });
    }

    const { prompt = "", width = 768, height = 768, steps = 12, guidance = 3.5 } = await safeJson(request);

    if (!prompt.trim()) {
      return Response.json({ error: "Falta prompt." }, { status: 400, headers: cors() });
    }

    // Prompt con una pizca de orientación segura
    const fullPrompt = [
      prompt,
      "high quality, sharp details, coherent composition, cinematic lighting"
    ].join(", ");

    const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(MODEL)}`;

    const hfResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        Accept: "image/png",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: fullPrompt,
        parameters: { width, height, num_inference_steps: steps, guidance_scale: guidance },
        options: { wait_for_model: true }
      }),
    });

    // Si el modelo aún está “cargando”, HF devuelve JSON
    const contentType = hfResp.headers.get("content-type") || "";
    if (!hfResp.ok) {
      const text = await hfResp.text();
      return new Response(text || JSON.stringify({ error: "HF request failed" }), {
        status: hfResp.status,
        headers: { ...cors(), "Content-Type": "application/json" }
      });
    }

    if (contentType.includes("application/json")) {
      // Respuesta no binaria (mensaje de cola/carga)
      const data = await hfResp.json();
      return Response.json({ error: "Modelo no entregó imagen todavía", details: data }, { status: 502, headers: cors() });
    }

    // Imagen binaria -> dataURL
    const buf = new Uint8Array(await hfResp.arrayBuffer());
    const b64 = base64FromBytes(buf);
    const dataUrl = `data:image/png;base64,${b64}`;

    return Response.json({ image: dataUrl }, { status: 200, headers: cors() });
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
async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function base64FromBytes(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  // navegador (no debería ejecutarse en Netlify), pero por si acaso:
  let binary = ""; bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

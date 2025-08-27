// File: netlify/functions/vision.js
// POST /.netlify/functions/vision
// Body: { task: "describe"|"qa"|"ocr"|"health", imageUrl? | imageB64?, question? }
// Env: OPENROUTER_API_KEY, (opcional) OCRSPACE_API_KEY

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization"
});
const json = (res, status = 200) => ({
  statusCode: status,
  headers: { ...cors(), "Content-Type": "application/json" },
  body: JSON.stringify(res)
});
const text = (body, status = 200) => ({
  statusCode: status,
  headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
  body
});

function parseBody(e){ try { return JSON.parse(e.body || "{}"); } catch { return {}; } }
function normalizeImage({ imageUrl, imageB64 }) {
  if (imageB64) return { type: "b64", data: imageB64.replace(/^data:image\/\w+;base64,/, "") };
  if (imageUrl) return { type: "url", data: imageUrl };
  return null;
}

/** ---- Providers ---- **/
async function ocr_space({ apiKey, image }) {
  const OCR_URL = "https://api.ocr.space/parse/image";
  const form = new URLSearchParams();
  form.append("language", "spa");
  form.append("OCREngine", "2");
  if (image.type === "url") form.append("url", image.data);
  if (image.type === "b64") form.append("base64Image", `data:image/png;base64,${image.data}`);
  const r = await fetch(OCR_URL, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!r.ok) throw new Error(`OCR.space error ${r.status}`);
  const d = await r.json();
  const text = d?.ParsedResults?.[0]?.ParsedText?.trim() || "";
  return { provider: "ocrspace", content: text };
}

async function qwen_vl_openrouter({ apiKey, task, image, question }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const model = "qwen/qwen-2.5-vl-7b-instruct";
  const parts = [];
  if (image?.type === "url") parts.push({ type: "image_url", image_url: { url: image.data } });
  if (image?.type === "b64") {
    parts.push({ type: "input_text", text: "[Imagen en base64]" });
    parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${image.data}` } });
  }
  const instruction =
    task === "ocr" ? "Transcribe TODO el texto visible. Devuelve solo el texto." :
    task === "qa"  ? `Responde brevemente la pregunta: ${question || "(sin pregunta)"}` :
                     "Describe la imagen con detalle y menciona texto visible.";
  const body = {
    model,
    messages: [
      { role: "system", content: "Eres un asistente experto en análisis de imágenes. Responde en español." },
      { role: "user", content: [ ...parts, { type: "input_text", text: instruction } ] }
    ]
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://innova-space-edu.github.io/",
      "X-Title": "Innova Space – MIRA"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`OpenRouter QwenVL error ${r.status}`);
  const d = await r.json();
  const content = d?.choices?.[0]?.message?.content || "";
  return { provider: "openrouter:qwen-vl", content };
}

async function llava_openrouter({ apiKey, task, image, question }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const model = "llava/llava-v1.6-vicuna-13b";
  const parts = [];
  if (image?.type === "url") parts.push({ type: "image_url", image_url: { url: image.data } });
  if (image?.type === "b64") {
    parts.push({ type: "input_text", text: "[Imagen en base64]" });
    parts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${image.data}` } });
  }
  const instruction =
    task === "ocr" ? "Transcribe TODO el texto visible. Devuelve solo el texto." :
    task === "qa"  ? `Responde brevemente la pregunta: ${question || "(sin pregunta)"}` :
                     "Describe la imagen con detalle y menciona texto visible.";
  const body = {
    model,
    messages: [
      { role: "system", content: "Eres LLaVA. Responde en español." },
      { role: "user", content: [ ...parts, { type: "input_text", text: instruction } ] }
    ]
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`OpenRouter LLaVA error ${r.status}`);
  const d = await r.json();
  const content = d?.choices?.[0]?.message?.content || "";
  return { provider: "openrouter:llava", content };
}

/** ---- Handler ---- **/
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return text("Method Not Allowed", 405);

  try {
    const body = parseBody(event);
    const { task = "describe", imageUrl, imageB64, question, prefer = [] } = body;
    const image = normalizeImage({ imageUrl, imageB64 });

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
    const OCRSPACE_API_KEY   = process.env.OCRSPACE_API_KEY || "";

    if (task === "health") {
      return json({ ok: true, providers: {
        openrouter: !!OPENROUTER_API_KEY,
        ocrspace: !!OCRSPACE_API_KEY
      }});
    }

    if (!image) return json({ error: "Missing imageUrl or imageB64" }, 400);

    // OCR directo si task=ocr
    if (task === "ocr") {
      // 1) OCR.space (mejor en texto denso)
      if (OCRSPACE_API_KEY) {
        try { return json(await ocr_space({ apiKey: OCRSPACE_API_KEY, image })); } catch (_) {}
      }
      // 2) Si no, que Qwen intente vía visión
      if (OPENROUTER_API_KEY) {
        const r = await qwen_vl_openrouter({ apiKey: OPENROUTER_API_KEY, task: "ocr", image });
        return json(r);
      }
      return json({ error: "No OCR providers available" }, 503);
    }

    // describe / qa → orden con prefer o por defecto
    const order = prefer.length ? prefer : ["openrouter:qwen-vl", "openrouter:llava"];
    let lastErr = null;

    for (const p of order) {
      try {
        if (p === "openrouter:qwen-vl" && OPENROUTER_API_KEY) {
          const r = await qwen_vl_openrouter({ apiKey: OPENROUTER_API_KEY, task, image, question });
          return json(r);
        }
        if (p === "openrouter:llava" && OPENROUTER_API_KEY) {
          const r = await llava_openrouter({ apiKey: OPENROUTER_API_KEY, task, image, question });
          return json(r);
        }
      } catch (e) { lastErr = e; }
    }

    if (lastErr) return json({ error: String(lastErr) }, 502);
    return json({ error: "No providers configured" }, 503);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

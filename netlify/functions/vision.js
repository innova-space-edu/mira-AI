// File: netlify/functions/vision.js
// Caption de imágenes con Hugging Face Inference API
// Env requerida: HF_API_KEY
// Opcionales: HF_VISION_MODELS (csv), HF_VQA_MODEL (para fallback con Qwen2‑VL)

const HF_API_KEY   = process.env.HF_API_KEY;
const HF_VQA_MODEL = process.env.HF_VQA_MODEL || "";
const HF_VISION_MODELS = (process.env.HF_VISION_MODELS ||
  "Salesforce/blip-image-captioning-base,nlpconnect/vit-gpt2-image-captioning"
).split(",").map(s => s.trim()).filter(Boolean);

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
});
const json = (obj, status = 200) => ({ statusCode: status, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(obj) });
const bad  = (msg, status = 400) => json({ error: msg }, status);

function dataUrlToBuffer(dataUrl = "") {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Formato dataURL inválido");
  const [, mime, b64] = m; return { buffer: Buffer.from(b64, "base64"), mime };
}

async function callHFImageToText(model, buffer, mime) {
  const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": mime || "application/octet-stream", Accept: "application/json" },
    body: buffer
  });
  const text = await r.text();
  let out; try { out = JSON.parse(text); } catch { out = text; }

  if (r.status === 404) { const e = new Error(`Model ${model} not found`); e.code = 404; throw e; }
  if (!r.ok) throw new Error(`HF ${model} ${r.status}: ${typeof out === "string" ? out : JSON.stringify(out)}`);

  let caption = "";
  if (Array.isArray(out)) caption = out[0]?.generated_text || out[0]?.caption || out[0]?.text || "";
  else if (out && typeof out === "object") caption = out.generated_text || out.caption || out.text || "";
  caption = String(caption || "").trim();
  if (!caption) throw new Error(`Respuesta vacía de ${model}`);
  return { model, caption, raw: out };
}

async function callQwenFallback(dataURL) {
  if (!/qwen2-vl/i.test(HF_VQA_MODEL)) throw new Error("Qwen fallback no disponible");
  const url = `https://api-inference.huggingface.co/models/${HF_VQA_MODEL}?wait_for_model=true`;
  const payload = {
    inputs: [{ role: "user", content: [ { type: "image", image_url: dataURL }, { type: "text", text: "Describe detalladamente la imagen en español." } ] }],
    parameters: { max_new_tokens: 160, do_sample: false }
  };
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const out = await r.json();
  if (!r.ok) throw new Error(`HF Qwen fallback ${r.status}: ${JSON.stringify(out)}`);
  const caption = (out.generated_text || (Array.isArray(out.outputs) && out.outputs[0]?.generated_text) || "").trim();
  if (!caption) throw new Error("Respuesta vacía de Qwen fallback");
  return { model: HF_VQA_MODEL, caption, via: "qwen-fallback" };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return bad("Method not allowed", 405);
  if (!HF_API_KEY) return bad("Falta HF_API_KEY en variables de entorno (Netlify).", 500);

  try {
    const { imageBase64 } = JSON.parse(event.body || "{}");
    if (!imageBase64) return bad("Falta imageBase64 (dataURL)");

    const { buffer, mime } = dataUrlToBuffer(imageBase64);

    const errors = [];
    for (const model of HF_VISION_MODELS) {
      try {
        const ok = await callHFImageToText(model, buffer, mime);
        return json({ ok: true, model: ok.model, caption: ok.caption, raw: ok.raw });
      } catch (e) {
        errors.push({ model, status: e.code || undefined, detail: e.message });
        continue;
      }
    }

    // Fallback con Qwen si está disponible
    try {
      const fb = await callQwenFallback(imageBase64);
      return json({ ok: true, model: fb.model, caption: fb.caption, via: fb.via });
    } catch (e) {
      // sin fallback o también falló
    }

    let hint = "Revisa HF_API_KEY y nombres de modelos en HF_VISION_MODELS.";
    if (errors.some(e => e.status === 404)) hint = "Modelo(s) no encontrado(s) (404). Corrige los nombres o permisos.";
    return json({ error: "HF request failed", details: errors, hint }, 502);
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

// File: netlify/functions/vqa.js
// VQA con Hugging Face (Qwen2‑VL ó BLIP‑VQA)
// Env: HF_API_KEY (requerida), HF_VQA_MODEL (opcional; default BLIP VQA)

const HF_MODEL   = process.env.HF_VQA_MODEL || "Salesforce/blip-vqa-base";
const HF_URL     = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;
const HF_API_KEY = process.env.HF_API_KEY;

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "OPTIONS, POST",
});
const json = (body, status = 200) => ({ statusCode: status, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const bad  = (msg, status = 400) => json({ error: msg }, status);

function dataUrlToBuffer(dataUrl = "") {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Formato dataURL inválido");
  const [, mime, b64] = m; return { buffer: Buffer.from(b64, "base64"), mime };
}
const isQwen = /qwen2-vl/i.test(HF_MODEL);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return bad("Method not allowed", 405);
  if (!HF_API_KEY) return bad("Falta HF_API_KEY en variables de entorno (Netlify).", 500);

  try {
    const { imageBase64, question } = JSON.parse(event.body || "{}");
    if (!imageBase64) return bad("Falta imageBase64 (dataURL)");
    const q = (question && String(question).trim()) || "Describe y responde: ¿qué información principal muestra la imagen?";

    let out;

    if (isQwen) {
      // Qwen2‑VL: chat multimodal
      const payload = {
        inputs: [{ role: "user", content: [ { type: "image", image_url: imageBase64 }, { type: "text", text: q } ] }],
        parameters: { max_new_tokens: 256, do_sample: false }
      };
      const r = await fetch(HF_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      out = await r.json();
      if (!r.ok) throw new Error(`HF ${r.status}: ${JSON.stringify(out)}`);
    } else {
      // BLIP‑VQA: primero JSON base64; si falla, binario + header
      const tryJson = async () => {
        const r = await fetch(HF_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ inputs: { image: imageBase64, question: q } }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`HF ${r.status}: ${JSON.stringify(data)}`);
        return data;
      };
      const tryBinary = async () => {
        const { buffer, mime } = dataUrlToBuffer(imageBase64);
        const r = await fetch(HF_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": mime || "application/octet-stream", "X-Question": q },
          body: buffer,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`HF ${r.status}: ${JSON.stringify(data)}`);
        return data;
      };
      try { out = await tryJson(); } catch { out = await tryBinary(); }
    }

    // Normalización de respuesta
    let answer = "";
    if (Array.isArray(out)) answer = out[0]?.generated_text || out[0]?.answer || out[0]?.label || "";
    else if (out) {
      answer = out.generated_text || out.answer || out.label || "";
      if (!answer && Array.isArray(out.outputs)) answer = out.outputs[0]?.generated_text || out.outputs[0]?.answer || "";
    }

    return json({ model: HF_MODEL, answer: String(answer || "").trim() });
  } catch (err) {
    console.error(err);
    return bad(`Error VQA: ${err.message || err}`);
  }
};

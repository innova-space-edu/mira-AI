// netlify/functions/vqa.js
// VQA con Hugging Face (Opción A: Salesforce/blip-vqa-base)

const HF_MODEL = process.env.HF_VQA_MODEL || "Salesforce/blip-vqa-base";
const HF_URL   = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;
const HF_API_KEY = process.env.HF_API_KEY;

// ---- Utilidades ----
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS, POST",
  };
}
function json(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
function bad(msg, status = 400) { return json({ error: msg }, status); }

function dataUrlToBuffer(dataUrl = "") {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Formato dataURL inválido");
  const [, mime, b64] = m;
  return { buffer: Buffer.from(b64, "base64"), mime };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return bad("Method not allowed", 405);
  if (!HF_API_KEY) return bad("Falta HF_API_KEY en variables de entorno (Netlify).", 500);

  try {
    const { imageBase64, question } = JSON.parse(event.body || "{}");
    if (!imageBase64) return bad("Falta imageBase64 (dataURL)");
    const q = (question && String(question).trim())
      || "Describe y responde: ¿qué información principal muestra la imagen?";

    // Intento 1: JSON base64 (BLIP-VQA lo suele aceptar)
    const tryJson = async () => {
      const r = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: { image: imageBase64, question: q } }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`HF ${r.status}: ${JSON.stringify(data)}`);
      return data;
    };

    // Intento 2: binario + header (algunos handlers prefieren binario)
    const tryBinary = async () => {
      const { buffer, mime } = dataUrlToBuffer(imageBase64);
      const r = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": mime || "application/octet-stream",
          "X-Question": q, // opcional: tu servidor puede leer esto
        },
        body: buffer,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(`HF ${r.status}: ${JSON.stringify(data)}`);
      return data;
    };

    // Ejecuta con tolerancia
    let out;
    try { out = await tryJson(); }
    catch { out = await tryBinary(); }

    // Normaliza la respuesta (BLIP VQA suele devolver [{generated_text: "..."}])
    let answer = "";
    if (Array.isArray(out)) {
      answer = out[0]?.generated_text || out[0]?.answer || out[0]?.label || "";
    } else if (out) {
      answer = out.generated_text || out.answer || out.label || "";
    }

    return json({ model: HF_MODEL, answer: String(answer || "").trim() });
  } catch (err) {
    console.error(err);
    return bad(`Error VQA: ${err.message || err}`);
  }
};

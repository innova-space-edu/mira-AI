// Serverless: Visual Question Answering estable con ViLT (HF Inference API)
// Env: HF_TOKEN

const HF_MODEL = "dandelin/vilt-b32-finetuned-vqa"; // estable en la Inference API
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

async function hfVqaFetch(body, tries = 3) {
  let lastTxt = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true, data: await r.json() };
    lastTxt = await r.text();
    if (r.status >= 500 || r.status === 429 || r.status === 408) {
      await new Promise(res => setTimeout(res, 1200 * (i + 1)));
      continue;
    }
    return { ok: false, status: r.status, detail: lastTxt };
  }
  return { ok: false, status: 503, detail: lastTxt || "Modelo no disponible (timeout/retries)" };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const {
      image_base64,
      question = "Describe la imagen y responde de forma breve.",
    } = JSON.parse(event.body || "{}");

    if (!image_base64) return { statusCode: 400, body: JSON.stringify({ error: "Falta image_base64" }) };

    // Formato de VQA en HF:
    // { "inputs": { "question": "...", "image": "<base64>" } }
    const payload = { inputs: { question, image: image_base64 } };

    const result = await hfVqaFetch(payload, 3);

    if (!result.ok) {
      return {
        statusCode: result.status || 500,
        body: JSON.stringify({ error: "HF VQA error", detail: result.detail }),
        headers: { "Content-Type": "application/json" },
      };
    }

    // Respuesta típica: [{ "answer": "..." , "score": 0.98 }]
    const out = result.data;
    const answer = Array.isArray(out) ? (out[0]?.answer || JSON.stringify(out[0] || out)) : (out?.answer || JSON.stringify(out));

    return {
      statusCode: 200,
      body: JSON.stringify({ answer }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "VQA failed", detail: String(e) }),
      headers: { "Content-Type": "application/json" },
    };
  }
};

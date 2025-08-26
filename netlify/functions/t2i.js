// /netlify/functions/t2i.js
// Text-to-Image usando Hugging Face Inference API (modelo FLUX.1-schnell)
// Entrada: JSON { prompt, width?, height?, steps? }
// Salida: JSON { image: "data:image/png;base64,..." }

const MODEL = "black-forest-labs/FLUX.1-schnell";

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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  const token = process.env.HF_API_KEY;
  if (!token) return json({ error: "Falta HF_API_KEY" }, 500);

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const { prompt, width = 768, height = 768, steps = 12 } = payload;
  if (!prompt || typeof prompt !== "string") return json({ error: "Falta prompt" }, 400);

  try {
    const resp = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "image/png"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { width, height, num_inference_steps: steps }
      })
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return json({ error: "HF error", details: errTxt }, resp.status);
    }

    const arrayBuf = await resp.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    return json({ image: `data:image/png;base64,${base64}` });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

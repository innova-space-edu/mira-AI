// netlify/functions/qwen.js
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const HF_MODEL = "Qwen/Qwen2-VL-7B-Instruct";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { imageBase64, prompt } = JSON.parse(event.body || "{}");
    if (!imageBase64) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Falta imageBase64" }) };
    }

    // Formato “messages” esperado por Qwen2-VL en Inference API
    const payload = {
      inputs: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt || "Describe la imagen con máximo detalle." },
            // Qwen soporta image_url base64:
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      // (opcional) hyperparams:
      parameters: { max_new_tokens: 512, temperature: 0.2 },
    };

    const resp = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.HF_TOKEN}`, // Requiere variable de entorno
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      // Devuelve info de error clara para depurar
      return {
        statusCode: resp.status || 502,
        headers: cors(),
        body: JSON.stringify({ error: "HF request failed", details: data }),
      };
    }

    // Respuesta puede venir como {generated_text: "..."} o como array de turnos
    const text =
      (Array.isArray(data) && data[0]?.generated_text) ||
      data.generated_text ||
      JSON.stringify(data);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

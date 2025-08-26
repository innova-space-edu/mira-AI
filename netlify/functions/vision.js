// netlify/functions/vision.js
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const MODELS = [
  "Salesforce/blip-image-captioning-base",
  "nlpconnect/vit-gpt2-image-captioning",
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { imageBase64 } = JSON.parse(event.body || "{}");
    if (!imageBase64) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Falta imageBase64" }) };

    const errors = [];
    for (const model of MODELS) {
      const url = `https://api-inference.huggingface.co/models/${model}?wait_for_model=true`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: imageBase64 }),
      });

      const data = await r.json();
      if (r.ok) {
        // BLIP/VIT suele devolver [{ generated_text: "..." }]
        const text = (Array.isArray(data) && data[0]?.generated_text) || data.generated_text || JSON.stringify(data);
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ text, model }) };
      }
      errors.push({ model, status: r.status, detail: data?.error || data });
    }

    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: "HF request failed", details: errors }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: e.message }) };
  }
};

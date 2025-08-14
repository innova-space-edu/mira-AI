// Serverless: Caption con BLIP en Hugging Face Inference API
// Requiere env: HF_TOKEN

const HF_MODEL = "Salesforce/blip-image-captioning-base";

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { image_base64 } = JSON.parse(event.body || "{}");
    if (!image_base64) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta image_base64" }) };
    }

    const buffer = Buffer.from(image_base64, "base64");
    const r = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer,
    });

    if (!r.ok) {
      const txt = await r.text();
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: "HF caption error", detail: txt }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const out = await r.json();
    const caption = Array.isArray(out) ? (out[0]?.generated_text || "") : (out?.generated_text || "");

    return {
      statusCode: 200,
      body: JSON.stringify({ caption }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Caption failed", detail: String(e) }),
      headers: { "Content-Type": "application/json" },
    };
  }
};

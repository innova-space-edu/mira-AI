// Serverless: VQA / razonamiento visual con Qwen2-VL en Hugging Face Inference API
// Requiere env: HF_TOKEN

const HF_MODEL = "Qwen/Qwen2-VL-7B-Instruct";

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const {
      image_base64,
      mime = "image/jpeg",
      question = "Describe la imagen y extrae datos relevantes del enunciado.",
    } = JSON.parse(event.body || "{}");

    if (!image_base64) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta image_base64" }) };
    }

    const payload = {
      inputs: [
        {
          role: "user",
          content: [
            { type: "image", image_base64, mime_type: mime },
            { type: "text", text: question },
          ],
        },
      ],
      parameters: { max_new_tokens: 512, temperature: 0.2 },
    };

    const r = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const txt = await r.text();
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: "HF VQA error", detail: txt }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const out = await r.json();
    const answer =
      out?.[0]?.generated_text ||
      out?.generated_text ||
      out?.outputs?.[0]?.content?.[0]?.text ||
      "(sin respuesta)";

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

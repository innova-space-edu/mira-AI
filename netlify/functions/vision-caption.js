// Serverless: Caption con BLIP en Hugging Face Inference API
// Env: HF_TOKEN

const HF_MODEL = "Salesforce/blip-image-captioning-base";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}?wait_for_model=true`;

async function hfFetchWithRetry(buffer, tries = 3) {
  let lastTxt = "";
  for (let i = 0; i < tries; i++) {
    const r = await fetch(HF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}` },
      body: buffer,
    });
    if (r.ok) return { ok: true, data: await r.json() };
    lastTxt = await r.text();
    // 503 o 5xx → espera y reintenta
    if (r.status >= 500 || r.status === 429 || r.status === 408) {
      await new Promise(res => setTimeout(res, 1200 * (i + 1)));
      continue;
    }
    // otros errores → rompe
    return { ok: false, status: r.status, detail: lastTxt };
  }
  return { ok: false, status: 503, detail: lastTxt || "Modelo no disponible (timeout/retries)" };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { image_base64 } = JSON.parse(event.body || "{}");
    if (!image_base64) return { statusCode: 400, body: JSON.stringify({ error: "Falta image_base64" }) };

    const buffer = Buffer.from(image_base64, "base64");
    const result = await hfFetchWithRetry(buffer, 3);

    if (!result.ok) {
      return {
        statusCode: result.status || 500,
        body: JSON.stringify({ error: "HF caption error", detail: result.detail }),
        headers: { "Content-Type": "application/json" },
      };
    }

    const out = result.data;
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

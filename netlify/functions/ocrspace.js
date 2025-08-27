const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { imageBase64, language = "spa" } = JSON.parse(event.body || "{}");
    if (!imageBase64) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Falta imageBase64" }) };
    if (!process.env.OCRSPACE_API_KEY) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Falta OCRSPACE_API_KEY" }) };

    const form = new URLSearchParams();
    form.append("base64Image", imageBase64);
    form.append("language", language);
    form.append("isOverlayRequired", "false");

    const resp = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "apikey": process.env.OCRSPACE_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    const data = await resp.json();
    if (!resp.ok || data.IsErroredOnProcessing) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "OCR error", details: data }) };
    }

    const text = (data.ParsedResults || []).map(r => r.ParsedText).join("\n").trim();
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: e.message }) };
  }
};

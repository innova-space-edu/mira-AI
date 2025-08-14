// Serverless: OCR con OCR.space
// Requiere env: OCR_SPACE_KEY

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { image_base64, mime = "image/jpeg", language = "spa" } = JSON.parse(event.body || "{}");
    if (!image_base64) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta image_base64" }) };
    }

    const form = new URLSearchParams();
    form.append("language", language);
    form.append("isTable", "true");
    form.append("scale", "true");
    form.append("OCREngine", "2");
    form.append("detectOrientation", "true");
    form.append("isOverlayRequired", "false");
    form.append("base64Image", `data:${mime};base64,${image_base64}`);

    const r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: process.env.OCR_SPACE_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const data = await r.json();
    const text = data?.ParsedResults?.[0]?.ParsedText?.trim?.() || "";

    return {
      statusCode: 200,
      body: JSON.stringify({ text }),
      headers: { "Content-Type": "application/json" },
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "OCR failed", detail: String(e) }),
      headers: { "Content-Type": "application/json" },
    };
  }
};

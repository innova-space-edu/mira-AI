// Netlify Function: /api/ocrspace  →  OCR.Space
// Requiere env: OCRSPACE_API_KEY
// Espera JSON: { imageBase64: "data:<mime>;base64,AAAA..." } o sin "data:"

const ALLOWED_ORIGIN = "*";

function stripHeader(data) {
  if (!data) return null;
  const i = data.indexOf(",");
  return i >= 0 ? data.slice(i + 1) : data;
}

export default async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const apiKey = process.env.OCRSPACE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: "Falta OCRSPACE_API_KEY en variables de entorno." };
    }

    const { imageBase64, language = "spa" } = JSON.parse(event.body || "{}");
    if (!imageBase64) {
      return { statusCode: 400, body: "Falta imageBase64" };
    }

    // OCR.Space acepta application/x-www-form-urlencoded con base64image
    const params = new URLSearchParams();
    params.set("apikey", apiKey);
    params.set("language", language);
    params.set("isOverlayRequired", "false");
    params.set("OCREngine", "2");
    params.set("base64Image", `data:image/png;base64,${stripHeader(imageBase64)}`);

    const r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const text = await r.text();
    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        body: text || `Error OCR.Space (HTTP ${r.status})`,
      };
    }

    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const parsed = data?.ParsedResults?.[0]?.ParsedText || "";

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ text: parsed }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      body: `Error en /api/ocrspace: ${err?.message || err}`,
    };
  }
};

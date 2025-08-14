// Function: /api/ocrspace  → OCR.Space
// Env requerida: OCRSPACE_API_KEY
// Body (JSON): { image_base64?: "<b64|dataURL>", imageBase64?: "<b64|dataURL>", language?: "spa" }

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type"
  };
}

// Devuelve la parte base64 (acepta dataURL)
function onlyBase64(s) {
  if (!s) return s;
  const i = s.indexOf(",");
  return i >= 0 ? s.slice(i + 1) : s;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }

    const apiKey = process.env.OCRSPACE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors(), body: "Falta OCRSPACE_API_KEY en variables de entorno." };
    }

    const body = JSON.parse(event.body || "{}");
    const raw = body.image_base64 || body.imageBase64 || body.image || null;
    const language = body.language || "spa";
    if (!raw) {
      return {
        statusCode: 400,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Falta image_base64" })
      };
    }

    // OCR.Space requiere form-urlencoded con base64Image dataURL
    const params = new URLSearchParams();
    params.set("apikey", apiKey);
    params.set("language", language);
    params.set("isOverlayRequired", "false");
    params.set("OCREngine", "2");
    params.set("base64Image", `data:image/png;base64,${onlyBase64(raw)}`);

    const r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const text = await r.text();
    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: { ...cors(), "Content-Type": "application/json" },
        body: text || `Error OCR.Space (HTTP ${r.status})`
      };
    }

    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const parsed = data && data.ParsedResults && data.ParsedResults[0] && data.ParsedResults[0].ParsedText || "";

    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: parsed })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "ocrspace function failed", detail: String(err && err.message || err) })
    };
  }
};

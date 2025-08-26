// /netlify/functions/caption.js
// Image-to-Text (captioning) con Hugging Face Inference API – BLIP
// Entrada 1: multipart/form-data (campo "image")
// Entrada 2: JSON { dataUrl: "data:image/png;base64,..." }
// Salida: JSON { text: "..." }

const MODEL = "Salesforce/blip-image-captioning-large";

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

// Helper: extraer Buffer desde data URL
function bufferFromDataUrl(dataUrl) {
  const m = /^data:(.*?);base64,(.*)$/.exec(dataUrl || "");
  if (!m) return null;
  const base64 = m[2];
  return Buffer.from(base64, "base64");
}

// Helper: parseo mínimo de multipart (para un solo archivo)
function parseMultipart(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.*)$/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1];
  const bodyBuf = Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
  const parts = bodyBuf.toString("binary").split(`--${boundary}`);

  for (const part of parts) {
    if (part.includes('name="image"')) {
      const idx = part.indexOf("\r\n\r\n");
      if (idx !== -1) {
        let content = part.substring(idx + 4);
        // Recortar el cierre
        content = content.replace(/\r\n--$/, "").replace(/\r\n$/, "");
        return Buffer.from(content, "binary");
      }
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  const token = process.env.HF_API_KEY;
  if (!token) return json({ error: "Falta HF_API_KEY" }, 500);

  let imageBuffer = null;

  // 1) multipart/form-data
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (contentType.startsWith("multipart/form-data")) {
    imageBuffer = parseMultipart(event);
  }

  // 2) JSON dataUrl
  if (!imageBuffer && contentType.includes("application/json")) {
    try {
      const { dataUrl } = JSON.parse(event.body || "{}");
      if (dataUrl) imageBuffer = bufferFromDataUrl(dataUrl);
    } catch { /* ignore */ }
  }

  if (!imageBuffer) return json({ error: "No se encontró imagen (usa 'image' multipart o 'dataUrl' JSON)" }, 400);

  try {
    const resp = await fetch(`https://api-inference.huggingface.co/models/${MODEL}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "image/png" // HF detecta PNG/JPEG sin problema
      },
      body: imageBuffer
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return json({ error: "HF error", details: errTxt }, resp.status);
    }

    const data = await resp.json();
    // BLIP suele devolver [{ generated_text: "..." }]
    const text = Array.isArray(data) && data[0]?.generated_text ? data[0].generated_text : JSON.stringify(data);
    return json({ text });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

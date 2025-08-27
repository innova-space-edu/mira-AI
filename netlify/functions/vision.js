// netlify/functions/vision.js
// Endpoint unificado de visión para tu frontend:
//  body JSON:
//   { task: "describe" | "qa" | "ocr", imageB64?: string, imageUrl?: string, question?: string, model?: string }
// Requiere: OPENROUTER_API_KEY

const ALLOW_ORIGIN = "*";

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
}
function json(res, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "application/json" }, body: JSON.stringify(res) };
}
function text(body, status = 200) {
  return { statusCode: status, headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" }, body };
}

const PREFERRED_MODELS = [
  // Qwen VL suele aceptar data: URLs mejor que varios LLaVA
  "qwen/qwen-2.5-vl-7b-instruct",
  "qwen/qwen-2.5-vl-3b-instruct",
  // Fallbacks LLaVA (pueden exigir URL pública; a veces rechazan data:)
  "llava/llava-v1.6-mistral-7b",
  "llava/llava-v1.6-34b",
];

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function toDataUrlMaybe(b64) {
  if (!b64) return null;
  if (/^data:image\//i.test(b64)) return b64; // ya es data URL
  return `data:image/png;base64,${b64}`;
}

function buildMessages({ task, question, imageUrlOrData }) {
  const promptBase =
    task === "ocr"
      ? "Transcribe TODO el texto visible en la imagen en español. Mantén el orden y no inventes texto."
      : task === "qa"
      ? (question?.trim() || "Responde con precisión a la pregunta sobre la imagen.")
      : "Describe con detalle la imagen en español (objetos, texto visible, colores, contexto).";

  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: promptBase },
        { type: "input_image", image_url: imageUrlOrData },
      ],
    },
  ];
}

async function callOpenRouterVision({ model, messages, temperature = 0.2 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no configurada");

  const siteUrl = process.env.OPENROUTER_SITE_URL || "https://example.com";
  const appName = process.env.OPENROUTER_APP_NAME || "Innova Space MIRA";

  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-Title": appName,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });

  const raw = await r.text();
  let data = {};
  try { data = JSON.parse(raw || "{}"); } catch {}

  if (!r.ok) {
    const detail = (data?.error?.message || data?.error || raw || "").slice(0, 2000);
    const err = new Error(`OpenRouter ${model} error ${r.status}: ${detail}`);
    err.status = r.status;
    throw err;
  }

  const text =
    data?.choices?.[0]?.message?.content?.trim?.() ||
    data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    "";
  return text;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json({ error: "Body JSON inválido." }, 400); }

  const task = (body.task || "describe").toLowerCase();
  const question = String(body.question || "");
  const imageUrl = body.imageUrl && String(body.imageUrl);
  const imageB64 = body.imageB64 && String(body.imageB64);
  const userModel = body.model && String(body.model);
  const imageUrlOrData = imageUrl || toDataUrlMaybe(imageB64);

  if (!imageUrlOrData) return json({ error: "Falta 'imageUrl' o 'imageB64'." }, 400);

  const messages = buildMessages({ task, question, imageUrlOrData });
  const modelsToTry = userModel ? [userModel, ...PREFERRED_MODELS.filter(m => m !== userModel)] : PREFERRED_MODELS;

  // Intentos en cascada
  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const out = await callOpenRouterVision({ model, messages });
      // Devolvemos un formato homogéneo con tu frontend:
      const field = task === "ocr" ? "text" : task === "qa" ? "answer" : "caption";
      return json({ content: out, [field]: out, model });
    } catch (e) {
      lastError = e;
      // Si el modelo rechaza data: URL (400), intentamos el siguiente
      if (e?.status && e.status >= 500) {
        // errores 5xx: breve pausa podría ayudar, pero lo omitimos por simplicidad
      }
    }
  }

  // Si nada funcionó:
  return json(
    {
      error: "Ningún modelo de visión aceptó la imagen.",
      detail: String(lastError?.message || lastError || "desconocido"),
      hints: [
        "Usa JPG/PNG ≤ ~2 MB.",
        "Si sigue fallando, prueba entregar una URL https pública en lugar de base64.",
        "Modelos LLaVA a veces no aceptan data: URLs; Qwen-VL suele funcionar mejor.",
      ],
    },
    // Importante: mantener 400 (no 502) para que el frontend muestre algo claro
    400
  );
};

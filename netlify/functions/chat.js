// File: netlify/functions/chat.js
// Function: /api/chat → proxy a Groq Chat Completions (OpenAI-compatible)
// Env requerida: GROQ_API_KEY

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization"
  };
}
function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(res)
  };
}
function text(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
    body
  };
}
function pickDefined(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return text("Method Not Allowed", 405);

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return text("Falta GROQ_API_KEY en variables de entorno.", 500);

    let payload = {};
    try { payload = JSON.parse(event.body || "{}"); }
    catch { return text("JSON inválido en el body.", 400); }

    const {
      model = "meta-llama/llama-4-scout-17b-16e-instruct",
      messages,
      temperature = 0.7,
      max_tokens, top_p, response_format, seed, stop, user
    } = payload;

    if (!Array.isArray(messages) || messages.length === 0) {
      return text("Falta 'messages' (array).", 400);
    }

    // Límite defensivo de tamaño
    const rawBody = JSON.stringify(payload);
    if (rawBody.length > 2_000_000) return text("Payload demasiado grande.", 413);

    // Construye cuerpo OpenAI-compatible
    const groqBody = { model, messages, temperature };
    Object.assign(groqBody, pickDefined(
      { max_tokens, top_p, response_format, seed, stop, user },
      ["max_tokens", "top_p", "response_format", "seed", "stop", "user"]
    ));

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Headers opcionales para trazabilidad
        "HTTP-Referer": event.headers?.origin || "https://innova-space-edu.github.io/",
        "X-Title": "Innova Space – MIRA"
      },
      body: JSON.stringify(groqBody)
    });

    // Passthrough sin tocar (mejor para compatibilidad de cliente)
    const textResp = await resp.text();
    return {
      statusCode: resp.ok ? 200 : resp.status,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: textResp || ""
    };
  } catch (err) {
    const detail = err?.message ? String(err.message) : String(err);
    return json({ error: "chat function failed", detail }, 500);
  }
};

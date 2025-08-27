// File: netlify/functions/groq-proxy.js
// Proxy OpenAI-compatible a Groq (fallback de /api/chat)
// Env requerida: GROQ_API_KEY

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
});
const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", ...cors() },
  body: JSON.stringify(obj)
});
const text = (body, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "text/plain; charset=utf-8", ...cors() },
  body
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return text("Falta GROQ_API_KEY en variables de entorno.", 500);

    const body = JSON.parse(event.body || "{}");
    const {
      messages = [],
      model = "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature = 0.4,
      top_p, max_tokens, response_format, stop, user
    } = body;

    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: "messages requerido" }, 400);
    }

    const reqBody = { model, messages, temperature };
    if (top_p !== undefined) reqBody.top_p = top_p;
    if (max_tokens !== undefined) reqBody.max_tokens = max_tokens;
    if (response_format !== undefined) reqBody.response_format = response_format;
    if (stop !== undefined) reqBody.stop = stop;
    if (user !== undefined) reqBody.user = user;

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": event.headers?.origin || "https://innova-space-edu.github.io/",
        "X-Title": "Innova Space – MIRA (fallback)"
      },
      body: JSON.stringify(reqBody)
    });

    const dataText = await r.text();
    const isJson = (dataText.trim().startsWith("{") || dataText.trim().startsWith("["));
    if (!r.ok) return json(isJson ? JSON.parse(dataText) : { error: "Groq error", details: dataText }, r.status);

    // Respuesta directa (sin alterar el formato)
    return {
      statusCode: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: dataText
    };
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

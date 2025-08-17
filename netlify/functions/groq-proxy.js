// netlify/functions/groq-proxy.js
// Proxy seguro hacia Groq (compatible con OpenAI Chat Completions)
// Env requerida: GROQ_API_KEY

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = JSON.parse(event.body || "{}");
    const { messages = [], model = "meta-llama/llama-4-scout-17b-16e-instruct", temperature = 0.4 } = body;
    if (!Array.isArray(messages) || !messages.length) return json({ error: "messages requerido" }, 400);

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, temperature })
    });

    const data = await r.json();
    if (!r.ok) return json({ error: "Groq error", details: data }, r.status);

    // Devolvemos el payload tal cual para máxima compatibilidad en el frontend
    return json(data);
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

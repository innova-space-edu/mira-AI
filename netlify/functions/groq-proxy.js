// File: netlify/functions/groq-proxy.js
// Proxy OpenAI‑compatible a Groq
// Env requerida: GROQ_API_KEY

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
});
const json = (obj, status = 200) => ({ statusCode: status, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST")   return json({ error: "Method not allowed" }, 405);

  try {
    const { messages = [], model = "meta-llama/llama-4-scout-17b-16e-instruct", temperature = 0.4 } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages) || !messages.length) return json({ error: "messages requerido" }, 400);

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature })
    });

    const data = await r.json();
    if (!r.ok) return json({ error: "Groq error", details: data }, r.status);
    return json(data);
  } catch (err) {
    return json({ error: "Exception", details: String(err) }, 500);
  }
};

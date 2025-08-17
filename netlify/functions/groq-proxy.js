// netlify/functions/groq-proxy.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { messages, model = "meta-llama/llama-4-scout-17b-16e-instruct", temperature = 0.2 } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages)) return json({ error: "messages[] requerido" }, 400);

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, temperature })
    });

    const data = await r.json();
    if (!r.ok) return json({ error: data.error || data }, r.status);

    const text = data.choices?.[0]?.message?.content ?? "";
    return json({ ok: true, text, raw: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}
function json(payload, statusCode = 200) {
  return { statusCode, headers: { "Content-Type": "application/json", ...cors() }, body: JSON.stringify(payload) };
}

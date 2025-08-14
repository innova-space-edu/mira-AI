// Function: /api/chat  → proxy a Groq Chat Completions
// Env requerida: GROQ_API_KEY

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type"
  };
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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: cors(), body: "Falta GROQ_API_KEY en variables de entorno." };
    }

    const { model, messages, temperature = 0.7 } = JSON.parse(event.body || "{}");

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "meta-llama/llama-4-scout-17b-16e-instruct",
        messages,
        temperature
      })
    });

    const text = await resp.text();

    return {
      statusCode: resp.ok ? 200 : resp.status,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: text || ""
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: "chat function failed", detail: String(err && err.message || err) })
    };
  }
};

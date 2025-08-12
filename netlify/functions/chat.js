// netlify/functions/chat.js
// Función serverless que llama a Groq usando la API Key guardada en Netlify

exports.handler = async (event) => {
  // CORS / preflight por si lo abres desde otro origen en el futuro
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Allow": "POST" },
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." }),
    };
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Falta GROQ_API_KEY en variables de entorno de Netlify" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  // Valores por defecto
  const model = payload.model || "meta-llama/llama-4-scout-17b-16e-instruct";
  const messages = payload.messages || [{ role: "user", content: "Hola" }];
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.7;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
    });

    const text = await groqRes.text();

    if (!groqRes.ok) {
      return {
        statusCode: groqRes.status,
        body: text || JSON.stringify({ error: "Error desde Groq" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Fallo de red al llamar a Groq", details: String(err) }),
    };
  }
};

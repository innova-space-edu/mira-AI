// Serverless proxy para Groq: oculta tu API key y resuelve CORS
// Ruta pública (gracias a netlify.toml):  /api/chat

const ALLOWLIST = new Set([
  "https://innova-space-edu.cl",
  "https://www.innova-space-edu.cl",
  "https://innova-space-edu.netlify.app",
  "https://innova-space-edu.github.io" // por si pruebas desde GH Pages
]);

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  const corsOrigin = ALLOWLIST.has(origin) ? origin : "*";

  const baseHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: baseHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ error: "Missing GROQ_API_KEY" }) };
    }

    const body = event.body || "{}";

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body
    });

    const text = await groqRes.text();
    return { statusCode: groqRes.status, headers: baseHeaders, body: text };
  } catch (err) {
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: "Proxy error", details: String(err) })
    };
  }
};

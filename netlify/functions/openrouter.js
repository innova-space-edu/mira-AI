// netlify/functions/openrouter.js
// Proxy → OpenRouter Chat Completions (no streaming)
// Env requeridas: OPENROUTER_API_KEY
// Opcionales: OPENROUTER_SITE_URL, OPENROUTER_APP_NAME

const ALLOW_ORIGIN = "*";

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
}
function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(res),
  };
}
function text(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
    body,
  };
}

// Asegura que los headers sean ASCII (evita ByteString 8211)
function safeHeader(val, fallback = "") {
  const s = String(val ?? fallback);
  return s.replace(/[^\x20-\x7E]/g, "-").slice(0, 200);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return text("Method Not Allowed", 405);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: "OPENROUTER_API_KEY no está configurada." }, 500);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json({ error: "JSON inválido en el body." }, 400); }

  const {
    model = "qwen/qwen-2.5-32b-instruct",
    messages = [],
    temperature = 0.7,
    max_tokens, top_p, presence_penalty, frequency_penalty,
    response_format, tools, tool_choice, seed,
    ...extras
  } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Faltan 'messages' en el body." }, 400);
  }

  const siteUrl = safeHeader(process.env.OPENROUTER_SITE_URL || "https://example.com");
  const appName = safeHeader(process.env.OPENROUTER_APP_NAME || "Innova Space MIRA");

  const payload = { model, messages, temperature, ...extras };
  if (max_tokens !== undefined) payload.max_tokens = max_tokens;
  if (top_p !== undefined) payload.top_p = top_p;
  if (presence_penalty !== undefined) payload.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) payload.frequency_penalty = frequency_penalty;
  if (response_format !== undefined) payload.response_format = response_format;
  if (tools !== undefined) payload.tools = tools;
  if (tool_choice !== undefined) payload.tool_choice = tool_choice;
  if (seed !== undefined) payload.seed = seed;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": siteUrl,
        "X-Title": appName,
      },
      body: JSON.stringify(payload),
    });

    const raw = await r.text();
    let data = {};
    try { data = JSON.parse(raw || "{}"); } catch {}

    if (!r.ok) {
      const detail = (data?.error?.message || data?.error || raw || "").slice(0, 2000);
      return json({ error: `OpenRouter HTTP ${r.status}`, detail }, r.status);
    }

    const viaOpenAI = data?.choices?.[0]?.message?.content?.trim?.() || "";
    return json({ text: viaOpenAI, ...data }, 200);
  } catch (e) {
    return json({ error: "Error conectando a OpenRouter", detail: String(e?.message || e) }, 502);
  }
};

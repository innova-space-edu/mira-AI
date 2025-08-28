// netlify/functions/chat.js
// Proxy a Groq Chat Completions: https://api.groq.com/openai/v1/chat/completions
// Body: { model, messages, temperature }

const ALLOW_ORIGIN = "*";
const ORIGIN_HEADERS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
const text = (body, status = 200) => ({
  statusCode: status,
  headers: { ...ORIGIN_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  body,
});

// Normalización para transporte (evita caracteres problemáticos)
function normalizeForTransport(s) {
  return String(s || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E]/g, "");
}
function sanitizeMessages(msgs) {
  return (msgs || []).map((m) => ({ ...m, content: normalizeForTransport(m.content) }));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: ORIGIN_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  if (!GROQ_API_KEY) return json({ error: "GROQ_API_KEY no configurada" }, 500);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json({ error: "JSON inválido" }, 400); }

  const model       = body.model || "meta-llama/llama-4-scout-17b-16e-instruct";
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
  const messages    = sanitizeMessages(body.messages || []);

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ model, messages, temperature, stream: false }),
    });

    const raw = await r.text();
    let data = {};
    try { data = JSON.parse(raw || "{}"); } catch {}

    if (!r.ok) {
      const detail = data?.error?.message || raw?.slice(0, 400);
      return json({ error: "chat function failed", detail }, r.status || 500);
    }

    const textOut = data?.choices?.[0]?.message?.content?.trim?.() || "";
    return json({ text: textOut }, 200);
  } catch (e) {
    return json({ error: "chat function failed", detail: String(e?.message || e) }, 500);
  }
};

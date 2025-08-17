// netlify/functions/groq-proxy.js
// Proxy a Groq Chat Completions (OpenAI-compatible)
// Requiere: process.env.GROQ_API_KEY
// Ruta típica: /.netlify/functions/groq-proxy
// Nota: No hace streaming; retorna la respuesta completa.

let _fetch = globalThis.fetch;
async function getFetch() {
  if (_fetch) return _fetch;
  // Fallback dinámico a node-fetch si el runtime no tiene fetch nativo
  const { default: f } = await import('node-fetch');
  _fetch = f;
  return _fetch;
}

// ---------- Helpers ----------
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(payload, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors(), ...extraHeaders },
    body: JSON.stringify(payload)
  };
}

function text(body, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...cors(), ...extraHeaders },
    body
  };
}

function pickDefined(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------- Handler ----------
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return text('Falta GROQ_API_KEY en variables de entorno.', 500);
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return text('JSON inválido en el body.', 400);
    }

    const {
      messages,
      model = "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature = 0.2,
      max_tokens,
      top_p,
      stop,
      seed,
      response_format, // { type: "json_object" | "text" } (compat OpenAI)
      user
    } = body;

    if (!Array.isArray(messages)) {
      return json({ error: "messages[] requerido" }, 400);
    }

    // Limitar tamaño de payload para evitar abusos accidentales
    const rawBody = JSON.stringify(body);
    if (rawBody.length > 2_000_000) { // ~2MB
      return text("Payload demasiado grande.", 413);
    }

    const groqPayload = {
      model,
      messages,
      temperature,
      ...pickDefined({ max_tokens, top_p, stop, seed, response_format, user },
                     ["max_tokens", "top_p", "stop", "seed", "response_format", "user"])
    };

    const f = await getFetch();
    const r = await f("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(groqPayload)
    });

    const textResp = await r.text();
    // Intentamos parsear para obtener error legible si falla
    let data;
    try { data = JSON.parse(textResp); } catch { data = null; }

    if (!r.ok) {
      return json({ error: (data && (data.error || data)) || textResp || "Groq error" }, r.status);
    }

    // Resumen útil + raw completo para quien lo necesite
    const assistantText = data?.choices?.[0]?.message?.content ?? "";
    return json({ ok: true, text: assistantText, raw: data }, 200);
  } catch (e) {
    const detail = (e && e.message) ? String(e.message) : String(e);
    return json({ error: "proxy failed", detail }, 500);
  }
};

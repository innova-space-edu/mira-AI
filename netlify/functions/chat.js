// File: functions/chat.js
// Function: /api/chat  → proxy a Groq Chat Completions
// Env requerida: GROQ_API_KEY
// Notas:
//  - Esta función NO hace streaming; retorna la respuesta completa.
//  - Puedes llamarla desde el front con fetch POST { model, messages, temperature?... }.
//  - Compatible con /api/chat y /.netlify/functions/chat (según hosting).

// ---------- Utilidades ----------
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type"
  };
}

function json(res, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "application/json" },
    body: JSON.stringify(res)
  };
}

function text(body, status = 200) {
  return {
    statusCode: status,
    headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
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
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return text("Method Not Allowed", 405);
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return text("Falta GROQ_API_KEY en variables de entorno.", 500);
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return text("JSON inválido en el body.", 400);
    }

    // Extracción y valores por defecto
    const {
      model = "meta-llama/llama-4-scout-17b-16e-instruct",
      messages,
      temperature = 0.7,
      max_tokens,
      top_p,
      response_format, // { type: "json_object" | "text" } según OpenAI compat
      seed,
      stop,
      // soporte para compatibilidad futura
      user // opcional
    } = payload;

    // Validación mínima
    if (!Array.isArray(messages) || messages.length === 0) {
      return text("Falta 'messages' (array) en el body.", 400);
    }

    // Límite prudente para evitar payloads gigantes desde el front
    const rawBody = JSON.stringify(payload);
    if (rawBody.length > 2_000_000) { // ~2MB
      return text("Payload demasiado grande.", 413);
    }

    // Cuerpo hacia Groq (OpenAI-compatible)
    const groqBody = {
      model,
      messages,
      temperature
    };

    // Solo incluimos los parámetros definidos
    Object.assign(
      groqBody,
      pickDefined(
        { max_tokens, top_p, response_format, seed, stop, user },
        ["max_tokens", "top_p", "response_format", "seed", "stop", "user"]
      )
    );

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(groqBody)
    });

    const textResp = await resp.text();

    // Pasamos el payload tal cual (JSON string) para mantener compatibilidad front
    return {
      statusCode: resp.ok ? 200 : resp.status,
      headers: { ...cors(), "Content-Type": "application/json" },
      body: textResp || ""
    };
  } catch (err) {
    // Mensaje de error seguro
    const detail = (err && err.message) ? String(err.message) : String(err);
    return json({ error: "chat function failed", detail }, 500);
  }
};

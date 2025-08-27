// File: netlify/functions/t2i.js
// POST /.netlify/functions/t2i  { prompt, provider="auto", options? }
// Env: FAL_KEY (Flux en FAL.ai), STABILITY_API_KEY (SDXL)

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization"
});
const json = (res, status = 200) => ({
  statusCode: status,
  headers: { ...cors(), "Content-Type": "application/json" },
  body: JSON.stringify(res)
});
const text = (body, status = 200) => ({
  statusCode: status,
  headers: { ...cors(), "Content-Type": "text/plain; charset=utf-8" },
  body
});

async function flux_FAL({ apiKey, prompt, options = {} }) {
  const url = "https://fal.run/fal-ai/flux-pro";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ...options })
  });
  if (!r.ok) throw new Error(`FAL Flux error ${r.status}`);
  const d = await r.json();
  const image = d?.images?.[0]?.url || d?.image?.url || null;
  return { provider: "fal:flux-pro", image };
}

async function sdxl_Stability({ apiKey, prompt, options = {} }) {
  const url = "https://api.stability.ai/v1/generation/sdxl-1024-v1-0/text-to-image";
  const body = {
    text_prompts: [{ text: prompt }],
    cfg_scale: options.cfg_scale ?? 7,
    steps: options.steps ?? 30,
    width: options.width ?? 1024,
    height: options.height ?? 1024,
    sampler: options.sampler || "K_EULER"
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Stability SDXL error ${r.status}`);
  const d = await r.json();
  const b64 = d?.artifacts?.[0]?.base64;
  const image = b64 ? `data:image/png;base64,${b64}` : null;
  return { provider: "stability:sdxl", image };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);

  try {
    const { prompt, provider = "auto", options = {} } = JSON.parse(event.body || "{}");
    if (!prompt) return json({ error: "Missing prompt" }, 400);

    const FAL_KEY = process.env.FAL_KEY || "";
    const STABILITY_API_KEY = process.env.STABILITY_API_KEY || "";

    const order = provider === "auto" ? ["fal", "sdxl"] : [provider];
    let lastErr = null;

    for (const p of order) {
      try {
        if (p === "fal" || p === "fal:flux-pro") {
          if (!FAL_KEY) throw new Error("FAL_KEY missing");
          const r = await flux_FAL({ apiKey: FAL_KEY, prompt, options });
          if (r?.image) return json({ ...r });
        }
        if (p === "sdxl" || p === "stability:sdxl") {
          if (!STABILITY_API_KEY) throw new Error("STABILITY_API_KEY missing");
          const r = await sdxl_Stability({ apiKey: STABILITY_API_KEY, prompt, options });
          if (r?.image) return json({ ...r });
        }
      } catch (e) { lastErr = e; }
    }

    if (lastErr) return json({ error: String(lastErr) }, 502);
    return json({ error: "No T2I providers configured" }, 503);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

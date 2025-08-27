// netlify/functions/hf-ping.js
export default async function handler(request) {
  const HF_API_KEY = process.env.HF_API_KEY;
  const { searchParams } = new URL(request.url);
  const model = searchParams.get("model") || "Salesforce/blip-image-captioning-base";
  if (!HF_API_KEY) {
    return Response.json({ ok: false, error: "Falta HF_API_KEY" }, { status: 401, headers: cors() });
  }
  try {
    const url = `https://huggingface.co/api/models/${encodeURIComponent(model)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${HF_API_KEY}` } });
    const data = await r.json();
    return Response.json({ ok: r.ok, status: r.status, model, gated: !!data?.gated, private: !!data?.private, cardExists: !!data?.modelId }, { headers: cors() });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: cors() });
  }
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

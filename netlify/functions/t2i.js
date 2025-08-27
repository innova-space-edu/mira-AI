// netlify/functions/t2i.js
export default async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const HF_API_KEY = process.env.HF_API_KEY;
    if (!HF_API_KEY) return res.status(500).json({ error: 'Falta HF_API_KEY' });

    const { prompt, width = 768, height = 768, steps = 12, guidance = 3 } = await readJSON(req);
    if (!prompt) return res.status(400).json({ error: 'Falta prompt' });

    const model = 'black-forest-labs/FLUX.1-schnell';
    const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          width, height, num_inference_steps: steps, guidance_scale: guidance
        },
        options: { wait_for_model: true }
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'HF request failed', detail: t });
    }

    const arrayBuffer = await r.arrayBuffer();
    // La API devuelve imagen binaria o JSON; si fue JSON, intentar leer bytes
    // Si es JSON, es que el endpoint respondió con {"error":...}; manejar
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = JSON.parse(Buffer.from(arrayBuffer).toString('utf8'));
      if (j.error) return res.status(502).json(j);
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    return res.json({ image: dataUrl, prompt });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected error' });
  }
};

async function readJSON(req){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

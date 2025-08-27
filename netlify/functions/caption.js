// netlify/functions/caption.js
export default async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const HF_API_KEY = process.env.HF_API_KEY;
    if (!HF_API_KEY) {
      return res.status(500).json({ error: 'Falta HF_API_KEY en variables de entorno.' });
    }

    // Parsear body: multipart (archivo) o JSON (imageUrl)
    let imageBytes = null;

    if (req.headers['content-type']?.includes('multipart/form-data')) {
      // Netlify parsea el body como Buffer si usamos raw
      // pero en funciones estándar, debemos reconstruir con busboy; simplificamos con arrayBuffer()
      const chunks = [];
      for await (const chunk of req) { chunks.push(chunk); }
      const boundary = req.headers['content-type'].match(/boundary=(.*)$/)?.[1];
      if (!boundary) return res.status(400).json({ error: 'multipart sin boundary' });

      // Parse muy simple (primer archivo)
      const buffer = Buffer.concat(chunks);
      const SEP = Buffer.from(`--${boundary}`);
      const parts = buffer.toString('binary').split(SEP);
      // Buscar parte que contenga "filename="
      const filePart = parts.find(p => /filename=".+"/.test(p));
      if (filePart) {
        const split = filePart.split('\r\n\r\n');
        imageBytes = Buffer.from(split.slice(1).join('\r\n\r\n'), 'binary');
        // remover final "--\r\n"
        const endIdx = imageBytes.lastIndexOf(Buffer.from('\r\n'));
        if (endIdx > 0) imageBytes = imageBytes.slice(0, endIdx);
      }
    } else {
      const { imageUrl } = await parseJSON(req);
      if (imageUrl) {
        const r = await fetch(imageUrl);
        imageBytes = Buffer.from(await r.arrayBuffer());
      }
    }

    if (!imageBytes) {
      return res.status(400).json({ error: 'Falta imagen (archivo o imageUrl).' });
    }

    const MODELS = [
      'Salesforce/blip-image-captioning-large',
      'Salesforce/blip-image-captioning-base',
      'nlpconnect/vit-gpt2-image-captioning'
    ];

    let lastErr = null;
    for (const model of MODELS) {
      try {
        const out = await hfInference(model, imageBytes, HF_API_KEY);
        if (out?.length && out[0]?.generated_text) {
          return res.json({ text: out[0].generated_text, model });
        }
        if (out?.generated_text) {
          return res.json({ text: out.generated_text, model });
        }
      } catch (err) {
        lastErr = formatErr(err);
        // probar siguiente
      }
    }
    return res.status(502).json({ error: 'HF request failed', details: lastErr || 'all models failed' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Unexpected error' });
  }
};

// Helpers
async function parseJSON(req){
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function hfInference(modelId, imageBytes, token){
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(modelId)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/octet-stream'
    },
    body: imageBytes,
  });
  if (r.status === 503) {
    // trigger warmup
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: imageBytes.toString('base64'), parameters: { wait_for_model: true } })
    });
    // reintento simple
    const r2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/octet-stream'
      },
      body: imageBytes,
    });
    if (!r2.ok) throw new Error(`${r2.status} ${await r2.text()}`);
    return r2.json();
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function formatErr(err){
  return typeof err === 'string' ? err : (err?.message || 'unknown');
}

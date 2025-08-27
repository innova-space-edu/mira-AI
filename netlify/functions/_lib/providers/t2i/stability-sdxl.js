// functions/_lib/providers/t2i/stability-sdxl.js
// Docs: https://platform.stability.ai/docs/api-reference
const STABILITY_URL = "https://api.stability.ai/v1/generation/sdxl-1024-v1-0/text-to-image";


async function sdxl_Stability({ apiKey, prompt, options = {} }) {
if (!apiKey) throw new Error("STABILITY_API_KEY missing");
const body = {
text_prompts: [{ text: prompt }],
cfg_scale: options.cfg_scale ?? 7,
steps: options.steps ?? 30,
width: options.width ?? 1024,
height: options.height ?? 1024,
sampler: options.sampler || "K_EULER"
};
const res = await fetch(STABILITY_URL, {
method: "POST",
headers: {
"Authorization": `Bearer ${apiKey}`,
"Content-Type": "application/json",
"Accept": "application/json"
},
body: JSON.stringify(body)
});
if (!res.ok) throw new Error(`Stability SDXL error ${res.status}`);
const data = await res.json();
const b64 = data?.artifacts?.[0]?.base64;
return { provider: "stability:sdxl", imageB64: b64, raw: data };
}


module.exports = { sdxl_Stability };

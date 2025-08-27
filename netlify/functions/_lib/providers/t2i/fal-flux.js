// functions/_lib/providers/t2i/fal-flux.js
// Docs: https://fal.ai/models/fal-ai/flux-pro
const FAL_URL = "https://fal.run/fal-ai/flux-pro";


async function flux_FAL({ apiKey, prompt, options = {} }) {
if (!apiKey) throw new Error("FAL_KEY missing");
const body = {
prompt,
...options // e.g., { guidance_scale: 3, num_inference_steps: 28, aspect_ratio: "1:1" }
};
const res = await fetch(FAL_URL, {
method: "POST",
headers: { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" },
body: JSON.stringify(body)
});
if (!res.ok) throw new Error(`FAL Flux error ${res.status}`);
const data = await res.json();
// FAL suele devolver { images: [{ url }] }
const url = data?.images?.[0]?.url || data?.image?.url || null;
return { provider: "fal:flux-pro", imageUrl: url, raw: data };
}


module.exports = { flux_FAL };

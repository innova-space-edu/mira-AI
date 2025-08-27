// functions/_lib/providers/vision/openrouter-llava.js
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";


async function llava_OpenRouter({ apiKey, task, image, question }) {
if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
const model = "llava/llava-v1.6-vicuna-13b"; // fallback estable


const userParts = [];
if (image?.type === "url") userParts.push({ type: "image_url", image_url: { url: image.data } });
if (image?.type === "b64") userParts.push({ type: "input_text", text: "[Imagen en base64 adjunta]" }, { type: "image_url", image_url: { url: `data:image/png;base64,${image.data}` } });


const instruction = task === "ocr" ?
"Transcribe TODO el texto visible con buena ortografía. Devuelve solo el texto principal."
: task === "qa" ?
`Responde la pregunta sobre la imagen de forma breve y precisa. Pregunta: ${question || "(sin pregunta)"}`
: "Describe la imagen con detalle (elementos, contexto y detalles relevantes).";


const body = {
model,
messages: [
{ role: "system", content: "Eres LLaVA. Responde en español." },
{ role: "user", content: [ ...userParts, { type: "input_text", text: instruction } ] }
]
};


const res = await fetch(OPENROUTER_URL, {
method: "POST",
headers: {
"Authorization": `Bearer ${apiKey}`,
"Content-Type": "application/json"
},
body: JSON.stringify(body)
});
if (!res.ok) throw new Error(`OpenRouter LLaVA error ${res.status}`);
const data = await res.json();
const content = data?.choices?.[0]?.message?.content || "";
return { provider: "openrouter:llava", content };
}


module.exports = { llava_OpenRouter };

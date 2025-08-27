// functions/_lib/providers/vision/dashscope-qwen.js
// Requiere DASHSCOPE_API_KEY. Usa formato Qwen-VL oficial.
const URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";


async function qwenVL_DashScope({ apiKey, task, image, question }) {
if (!apiKey) throw new Error("DASHSCOPE_API_KEY missing");
const input = [
{ role: "user", content: [
image?.type === "url" ? { image: image.data } : null,
image?.type === "b64" ? { image: `data:image/png;base64,${image.data}` } : null,
{ text: task === "ocr" ? "Transcribe el texto visible" : task === "qa" ? (question || "Responde sobre la imagen") : "Describe la imagen" }
].filter(Boolean) }
];


const body = {
model: "qwen-vl-plus", // o qwen-vl-max si tienes acceso
input
};


const res = await fetch(URL, {
method: "POST",
headers: {
"Authorization": `Bearer ${apiKey}`,
"Content-Type": "application/json"
},
body: JSON.stringify(body)
});
if (!res.ok) throw new Error(`DashScope QwenVL error ${res.status}`);
const data = await res.json();
const content = data?.output?.text || data?.output?.choices?.[0]?.message?.content || "";
return { provider: "dashscope:qwen-vl", content };
}


module.exports = { qwenVL_DashScope };

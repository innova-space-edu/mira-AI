// functions/vision.js
const { parseBody, normalizeImagePayload } = require("./_lib/utils");
const { qwenVL_OpenRouter } = require("./_lib/providers/vision/openrouter-qwen");
const { llava_OpenRouter } = require("./_lib/providers/vision/openrouter-llava");
const { qwenVL_DashScope } = require("./_lib/providers/vision/dashscope-qwen");
const { ocrSpace } = require("./_lib/providers/ocr/ocrspace");


exports.handler = async (event) => {
if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);


try {
const body = parseBody(event);
const { task = "describe", imageUrl, imageB64, question, prefer = [] } = body;
const image = normalizeImagePayload({ imageUrl, imageB64 });
if (!image && task !== "health") return json({ error: "Missing imageUrl or imageB64" }, 400);


const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const OCRSPACE_API_KEY = process.env.OCRSPACE_API_KEY;


// Salud del endpoint
if (task === "health") return json({ ok: true, providers: {
openrouter: !!OPENROUTER_API_KEY,
dashscope: !!DASHSCOPE_API_KEY,
ocrspace: !!OCRSPACE_API_KEY
}});


// Atajo: OCR directo si task=ocr
if (task === "ocr") {
// Primero OCR.space (suele ser mejor en texto denso)
if (OCRSPACE_API_KEY) {
try { return json(await ocrSpace({ apiKey: OCRSPACE_API_KEY, image })); } catch (e) {}
}
// Si no hay OCR.space o falla, que Qwen‑VL lo intente por visión
if (OPENROUTER_API_KEY) {
const r = await qwenVL_OpenRouter({ apiKey: OPENROUTER_API_KEY, task: "ocr", image });
return json(r);
}
if (DASHSCOPE_API_KEY) {
const r = await qwenVL_DashScope({ apiKey: DASHSCOPE_API_KEY, task: "ocr", image });
return json(r);
}
return json({ error: "No OCR providers available" }, 503);
}


// Para describe / qa → intenta en este orden configurable
const order = prefer.length ? prefer : [
"openrouter:qwen-vl",
"dashscope:qwen-vl",
"openrouter:llava"
];


let lastErr = null;
for (const p of order) {
try {
if (p === "openrouter:qwen-vl" && OPENROUTER_API_KEY) {
const r = await qwenVL_OpenRouter({ apiKey: OPENROUTER_API_KEY, task, image, question });
return json(r);
}
if (p === "dashscope:qwen-vl" && DASHSCOPE_API_KEY) {
const r = await qwenVL_DashScope({ apiKey: DASHSCOPE_API_KEY, task, image, question });
return json(r);
}
if (p === "openrouter:llava" && OPENROUTER_API_KEY) {
const r = await llava_OpenRouter({ apiKey: OPENROUTER_API_KEY, task, image, question });
return json(r);
}
} catch (err) { lastErr = err; }
}


if (lastErr) return json({ error: String(lastErr) }, 502);
return json({ error: "No providers configured" }, 503);
} catch (e) {
return json({ error: String(e) }, 500);
}
};

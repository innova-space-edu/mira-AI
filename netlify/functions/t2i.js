// functions/t2i.js
const { json, text, cors } = require("./_lib/cors");
const { parseBody } = require("./_lib/utils");
const { flux_FAL } = require("./_lib/providers/t2i/fal-flux");
const { sdxl_Stability } = require("./_lib/providers/t2i/stability-sdxl");


exports.handler = async (event) => {
if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
if (event.httpMethod !== "POST") return text("Method Not Allowed", 405);


try {
const body = parseBody(event);
const { prompt, provider = "auto", options = {} } = body;
if (!prompt) return json({ error: "Missing prompt" }, 400);


const FAL_KEY = process.env.FAL_KEY;
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;


const order = provider === "auto" ? ["fal:flux-pro", "stability:sdxl"] : [provider];
let lastErr = null;


for (const p of order) {
try {
if (p === "fal:flux-pro" && FAL_KEY) {
const r = await flux_FAL({ apiKey: FAL_KEY, prompt, options });
return json(r);
}
if (p === "stability:sdxl" && STABILITY_API_KEY) {
const r = await sdxl_Stability({ apiKey: STABILITY_API_KEY, prompt, options });
return json(r);
}
} catch (err) { lastErr = err; }
}


if (lastErr) return json({ error: String(lastErr) }, 502);
return json({ error: "No T2I providers configured" }, 503);
} catch (e) {
return json({ error: String(e) }, 500);
}
};

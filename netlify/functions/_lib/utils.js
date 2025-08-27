// functions/_lib/utils.js
function parseBody(event) {
try { return JSON.parse(event.body || "{}"); } catch { return {}; }
}


function pickDefined(obj, keys) {
const out = {}; for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]; return out;
}


function normalizeImagePayload({ imageUrl, imageB64 }) {
if (imageB64) return { type: "b64", data: imageB64 };
if (imageUrl) return { type: "url", data: imageUrl };
return null;
}


module.exports = { parseBody, pickDefined, normalizeImagePayload };

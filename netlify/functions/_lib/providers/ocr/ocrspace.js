// functions/_lib/providers/ocr/ocrspace.js
const OCR_URL = "https://api.ocr.space/parse/image";


async function ocrSpace({ apiKey, image }) {
if (!apiKey) throw new Error("OCRSPACE_API_KEY missing");
if (!image) throw new Error("No image for OCR");


const form = new URLSearchParams();
form.append("language", "spa");
form.append("OCREngine", "2"); // 2=avanzado


if (image.type === "url") {
form.append("url", image.data);
} else if (image.type === "b64") {
form.append("base64Image", `data:image/png;base64,${image.data}`);
}


const res = await fetch(OCR_URL, {
method: "POST",
headers: { "apikey": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
body: form
});
if (!res.ok) throw new Error(`OCR.space error ${res.status}`);
const data = await res.json();
const text = data?.ParsedResults?.[0]?.ParsedText?.trim() || "";
return { provider: "ocrspace", content: text };
}


module.exports = { ocrSpace };

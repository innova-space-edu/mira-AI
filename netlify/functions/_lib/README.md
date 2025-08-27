# Providers y tareas


## Image→Text
- Qwen‑VL (OpenRouter o DashScope): descripción, OCR aproximado, VQA.
- LLaVA (OpenRouter): fallback para descripción/VQA.
- OCR.space: OCR dedicado (mejor en texto denso).


### Body vision.js
{
"task": "describe" | "qa" | "ocr" | "health",
"imageUrl": "https://..." | null,
"imageB64": "..." | null,
"question": "(opcional)",
"prefer": ["openrouter:qwen-vl", "dashscope:qwen-vl", "openrouter:llava"]
}


## Text→Image
- Flux (FAL.ai): calidad alta y rápida.
- SDXL (Stability): alternativa sólida.


### Body t2i.js
{
"prompt": "...",
"provider": "auto" | "fal:flux-pro" | "stability:sdxl",
"options": { "steps": 28, "cfg_scale": 5, "aspect_ratio": "1:1" }
}

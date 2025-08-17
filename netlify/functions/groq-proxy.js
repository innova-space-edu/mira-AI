export default async (req) => {
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });

  const { messages, model } = await req.json();
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey)
    return new Response(JSON.stringify({ error: "GROQ_API_KEY faltante" }), { status: 500 });

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });

  const data = await r.json();
  return new Response(JSON.stringify({ content: data?.choices?.[0]?.message?.content || "" }), { status: 200 });
}

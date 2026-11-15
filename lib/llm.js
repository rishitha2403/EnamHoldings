// Model routing. Bulk extraction -> cheap model; judgement -> stronger model.
// Gemini REST (free tier is enough). Swap providers by changing call().
const CHEAP = process.env.FINN_CHEAP_MODEL || "gemini-2.5-flash-lite";
const STRONG = process.env.FINN_STRONG_MODEL || "gemini-2.5-flash";

async function call(model, prompt, { json = true, temperature = 0.1 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY not set on the server"), { status: 503 });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature, ...(json ? { responseMimeType: "application/json" } : {}) } }),
  });
  if (!r.ok) throw Object.assign(new Error(`LLM ${model} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const usage = j.usageMetadata || {};
  if (!json) return { text, usage };
  try { return { data: JSON.parse(text.replace(/^```json|```$/g, "").trim()), usage }; }
  catch { throw Object.assign(new Error("model returned non-JSON"), { status: 502 }); }
}

module.exports = { call, CHEAP, STRONG };

module.exports = (req, res) => res.status(200).json({ ok: true, llm: !!process.env.GEMINI_API_KEY });

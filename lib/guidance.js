// Promised vs delivered, live, for any company.
// 1. transcripts (primary) -> keyword pre-filter (free) -> cheap model extracts guidance claims with verbatim quotes
// 2. every quote is verified against the transcript text in code; unverifiable quotes are dropped (anti-hallucination)
// 3. stronger model judges each claim ONLY against the reported-numbers table we pass in
const pdf = require("pdf-parse/lib/pdf-parse.js");
const { call, CHEAP, STRONG } = require("./llm");

const KEY = /\b(guid|expect|target|outlook|aspir|confident|going forward|next (year|quarter)|FY ?2\d|FY2\d|margin|growth|capex|order book|by (the )?end of)/i;

async function transcriptText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bseindia.com/" } });
  if (!r.ok) throw new Error(`transcript HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const out = await pdf(buf);
  return out.text.replace(/\r/g, "");
}

// Keep only paragraphs that look forward-looking; caps tokens sent to the model (~70% saving).
function prefilter(text, cap = 9000) {
  const paras = text.split(/\n\s*\n|(?<=\.)\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 60);
  const keep = paras.filter((p) => KEY.test(p));
  let out = "", n = 0;
  for (const p of keep) { if (out.length + p.length > cap) break; out += p + "\n\n"; n++; }
  return { text: out, kept: n, total: paras.length };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
function verifyQuote(quote, source) {
  const q = norm(quote), s = norm(source);
  if (q.length < 12) return false;
  if (s.includes(q)) return true;
  // tolerate minor transcription differences: 85% of 5-word shingles must appear
  const w = q.split(" "), sh = [];
  for (let i = 0; i + 5 <= w.length; i++) sh.push(w.slice(i, i + 5).join(" "));
  return sh.length > 0 && sh.filter((x) => s.includes(x)).length / sh.length >= 0.85;
}

function numbersTable(F) {
  const n = F.q_labels.length;
  const k = Math.min(6, n);
  const rows = F.q_labels.slice(-k).map((l, i) => { const j = n - k + i; return `${l}: sales ${F.q.sales[j]}, EBITDA ${F.q.ebitda?.[j]}, OPM ${F.q.opm?.[j]}%, PAT ${F.q.pat[j]}`; });
  const yl = F.y_labels || [];
  const ky = Math.min(4, yl.length);
  const yrows = yl.slice(-ky).map((l, i) => { const j = yl.length - ky + i; return `${l}: sales ${F.y.sales[j]}, OPM ${F.y.opm?.[j]}%, PAT ${F.y.pat[j]}`; });
  const cf = F.cf ? F.cf_labels.slice(-3).map((l, i) => `${l}: CFO ${F.cf.cfo.at(-3 + i)}`).join("; ") : "n/a";
  return `Quarterly (₹ cr):\n${rows.join("\n")}\nAnnual:\n${yrows.join("\n")}\nOperating cash flow: ${cf}`;
}

async function promisedVsDelivered(F, max = 4) {
  const calls = (F.docs?.concalls || []).slice(0, max);
  if (!calls.length) throw Object.assign(new Error("No concall transcripts listed for this company"), { status: 404 });
  const sources = [], extracted = [], usage = { cheap: 0, strong: 0 }, fullText = {};
  const texts = await Promise.allSettled(calls.map((c) => transcriptText(c.url)));
  for (let i = 0; i < calls.length; i++) {
    if (texts[i].status !== "fulfilled") continue;
    const id = "t" + i, full = texts[i].value;
    fullText[id] = full;
    sources.push({ id, label: `Concall · ${calls[i].date}`, url: calls[i].url });
    const pf = prefilter(full);
    const { data, usage: u } = await call(CHEAP, `You extract management GUIDANCE from an Indian listed company's earnings-call transcript excerpt.
Return JSON: {"claims":[{"topic": short label (e.g. "FY27 revenue growth"), "metric": one of sales_growth|ebitda_margin|pat|capex|cash_flow|working_capital|order_book|debt|other, "quote": EXACT verbatim sentence fragment from the text (max 35 words, copy characters exactly), "speaker": name if visible else "Management"}]}
Rules: only forward-looking statements with a number or a clear direction; max 6 claims; never paraphrase inside "quote"; no outside knowledge.
TRANSCRIPT (${calls[i].date}):\n${pf.text}`);
    usage.cheap += u.totalTokenCount || 0;
    for (const c of data.claims || []) if (verifyQuote(c.quote, full)) extracted.push({ ...c, src: id });
  }
  if (!extracted.length) throw Object.assign(new Error("No verifiable guidance found in transcripts"), { status: 422 });
  const { data, usage: u2 } = await call(STRONG, `You are a buy-side analyst checking what management PROMISED against what the company DELIVERED.
Use ONLY the claims and the numbers table below. Do not use any outside knowledge about the company. If the numbers can't settle a claim, verdict = "too_early".
Group claims on the same topic into one item with a trail (oldest first). Return JSON:
{"claims":[{"topic":..., "trail":[{"src":..., "who":..., "quote":...}], "delivered": one sentence citing the specific numbers, "verdict": "kept"|"missed"|"mixed"|"on_track"|"at_risk"|"too_early", "note": one sharp sentence on what an investor should ask or watch}]}
CLAIMS:\n${JSON.stringify(extracted)}\nNUMBERS (${F.name}):\n${numbersTable(F)}`, { temperature: 0.2 });
  usage.strong += u2.totalTokenCount || 0;
  // keep only quotes that really appear in a transcript (the judge may trim or re-punctuate them)
  const all = Object.values(fullText).join("\n");
  const inText = (q) => q && (verifyQuote(q, all) || extracted.some((e) => verifyQuote(q, e.quote) || verifyQuote(e.quote, q)));
  const words = (q) => new Set(norm(q || "").split(" ").filter((w) => w.length > 2));
  const sim = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
  const fix = (t) => {
    if (inText(t.quote)) return t;
    // judge reworded a real quote: swap in the closest verified original (same transcript first)
    const best = extracted.map((e) => ({ e, s: sim(t.quote, e.quote) + (e.src === t.src ? 0.05 : 0) })).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= 0.6 ? { ...t, src: best.e.src, quote: best.e.quote } : null;
  };
  let claims = (data.claims || []).map((c) => ({ ...c, trail: (c.trail || []).map(fix).filter(Boolean) })).filter((c) => c.trail.length);
  if (!claims.length) {
    // fallback: show the verified extracted claims themselves, unjudged
    claims = extracted.map((e) => ({ topic: e.topic, trail: [{ src: e.src, who: e.speaker || "Management", quote: e.quote }],
      delivered: "Not yet checked against reported numbers.", verdict: "too_early", note: "" }));
  }
  return { sources, claims, model: `${CHEAP} → ${STRONG}`, usage };
}

module.exports = { promisedVsDelivered, prefilter, verifyQuote, numbersTable };

// FINN engines: pure functions over the data bundle. No DOM here, so the same
// code runs in the browser, in tests (node), and could run in a worker.

// ---------------------------------------------------------------- utilities
export const pct = (a, b) => (b === 0 || b == null || a == null ? null : ((a - b) / Math.abs(b)) * 100);
export const cagr = (end, start, yrs) => (start > 0 && end > 0 ? (Math.pow(end / start, 1 / yrs) - 1) * 100 : null);
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

// ---------------------------------------------------------------- PUSH: alerts
// Special/short sessions (e.g. Diwali Muhurat) are excluded from baselines and alerts.
export const SPECIAL_SESSIONS = new Set(["2026-11-08"]);

export function priceAlerts(prices, dates, cfg, filings = []) {
  const out = [];
  for (const [sym, s] of Object.entries(prices)) {
    for (let i = 1; i < dates.length; i++) {
      if (SPECIAL_SESSIONS.has(dates[i])) continue;
      let j = i - 1;
      while (j >= 0 && SPECIAL_SESSIONS.has(dates[j])) j--;
      if (j < 0) continue;
      const chg = pct(s.c[i], s.c[j]);
      const base = [];
      for (let k = i - 1; k >= 0 && base.length < 10; k--) if (!SPECIAL_SESSIONS.has(dates[k])) base.push(s.v[k]);
      if (base.length < 5) continue;
      const vr = s.v[i] / mean(base);
      const hitP = Math.abs(chg) >= cfg.pricePct;
      const hitV = vr >= cfg.volX;
      if (!hitP && !hitV) continue;
      const d = dates[i];
      // explain the move with a filing from the previous 36h, if any
      const near = filings
        .filter((f) => f.sym === sym && f.priority >= 35)
        .filter((f) => { const h = (new Date(d + "T15:30:00+05:30") - new Date(f.ts + "+05:30")) / 36e5; return h >= -1 && h <= 40; })
        .sort((a, b) => b.priority - a.priority)[0];
      const severity = Math.min(100, Math.round(Math.abs(chg) * 4 + Math.log2(Math.max(vr, 1)) * 12 + (hitP && hitV ? 15 : 0)));
      out.push({ sym, date: d, ts: d + "T15:30:00", chg, vr, close: s.c[i], hitP, hitV, severity, explainedBy: near ? near.id : null });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.severity - a.severity));
}

// Group filings into stories: same company, same category, within 72h.
export function stories(filings) {
  const groups = [];
  for (const f of [...filings].sort((a, b) => (a.ts < b.ts ? 1 : -1))) {
    const g = groups.find((g) => g.sym === f.sym && g.category === f.category && Math.abs(new Date(g.ts) - new Date(f.ts)) < 72 * 36e5);
    if (g) { g.items.push(f); g.priority = Math.max(g.priority, f.priority); g.people = [...new Set([...g.people, ...f.people])]; g.flags = [...new Set([...g.flags, ...f.flags])]; }
    else groups.push({ sym: f.sym, name: f.name, category: f.category, ts: f.ts, priority: f.priority, items: [f], people: [...f.people], flags: [...f.flags] });
  }
  for (const g of groups) g.treatment = g.priority >= 70 ? "brief" : g.priority >= 35 ? "line" : "fold";
  return groups;
}

// ---------------------------------------------------------------- PULL: analysis
export function resultsTable(F) {
  if (!F || !F.q) return null;
  const n = F.q_labels.length - 1;
  const row = (k) => ({ cur: F.q[k][n], qoq: pct(F.q[k][n], F.q[k][n - 1]), yoy: pct(F.q[k][n], F.q[k][n - 4]), prev: F.q[k][n - 1], ya: F.q[k][n - 4] });
  const t = { label: F.q_labels[n], prevLabel: F.q_labels[n - 1], yaLabel: F.q_labels[n - 4], rows: {} };
  t.rows.Revenue = row("sales");
  t.rows.EBITDA = row("ebitda");
  t.rows.PBT = row("pbt");
  t.rows.PAT = row("pat");
  t.margin = { cur: (F.q.ebitda[n] / F.q.sales[n]) * 100, prev: (F.q.ebitda[n - 1] / F.q.sales[n - 1]) * 100, ya: (F.q.ebitda[n - 4] / F.q.sales[n - 4]) * 100 };
  return t;
}

export function analyse(F) {
  const A = { snapshot: [], trajectory: [], balance: [], cash: [], flags: { green: [], red: [] }, bull: [], bear: [] };
  if (!F) return A;
  const y = F.y || {}, yl = F.y_labels || [];
  const lastFY = yl.indexOf("TTM") > 0 ? yl.indexOf("TTM") - 1 : yl.length - 1;
  const rt = resultsTable(F);
  // snapshot
  A.snapshot.push(["Price", F.price != null ? `₹${F.price.toLocaleString("en-IN")}` : "—"]);
  A.snapshot.push(["Market cap", F.mcap_cr != null ? `₹${Math.round(F.mcap_cr).toLocaleString("en-IN")} cr` : "—"]);
  A.snapshot.push(["P/E", F.pe ?? "—"]);
  A.snapshot.push(["ROCE / ROE", `${F.roce ?? "—"}% / ${F.roe ?? "—"}%`]);
  if (y.sales) A.snapshot.push(["TTM revenue", `₹${y.sales[y.sales.length - 1].toLocaleString("en-IN")} cr`]);
  if (rt) A.snapshot.push([`${rt.label} rev YoY`, fmtPct(rt.rows.Revenue.yoy)]);
  if (rt) A.snapshot.push([`${rt.label} EBITDA margin`, `${rt.margin.cur.toFixed(1)}%`]);
  if (F.hi52) A.snapshot.push(["52w range", `₹${F.lo52.toLocaleString("en-IN")}–${F.hi52.toLocaleString("en-IN")}`]);

  // trajectory
  if (y.sales && lastFY >= 5) {
    const s3 = cagr(y.sales[lastFY], y.sales[lastFY - 3], 3), s5 = cagr(y.sales[lastFY], y.sales[lastFY - 5], 5);
    const p3 = cagr(y.pat[lastFY], y.pat[lastFY - 3], 3), p5 = cagr(y.pat[lastFY], y.pat[lastFY - 5], 5);
    A.trajectory.push({ k: "Revenue CAGR", v: `${fmtPct(s3, 0)} 3y · ${fmtPct(s5, 0)} 5y` });
    A.trajectory.push({ k: "PAT CAGR", v: `${fmtPct(p3, 0)} 3y · ${fmtPct(p5, 0)} 5y` });
    const opmNow = y.opm[lastFY], opmPeak = Math.max(...y.opm.slice(0, lastFY + 1)), opm3 = y.opm[lastFY - 3];
    A.trajectory.push({ k: "EBITDA margin", v: `${opmNow}% (3y ago ${opm3}%, peak ${opmPeak}%)` });
    const ttm = y.sales.length - 1;
    if (yl[ttm] === "TTM") {
      const g = pct(y.sales[ttm], y.sales[lastFY]);
      A.trajectory.push({ k: "TTM vs last FY", v: `revenue ${fmtPct(g)} · PAT ${fmtPct(pct(y.pat[ttm], y.pat[lastFY]))}` });
    }
    if (s3 != null && s3 > 20) A.flags.green.push(`Revenue compounding ${s3.toFixed(0)}% over 3 years`);
    if (s3 != null && s3 < 5) A.flags.red.push(`Revenue growth has stalled: ${s3.toFixed(0)}% 3y CAGR`);
    if (opmNow <= opmPeak - 5) A.flags.red.push(`Margin ${opmPeak - opmNow} pts below peak (${opmPeak}% → ${opmNow}%)`);
  }
  if (rt) {
    if (rt.rows.PAT.yoy != null && rt.rows.PAT.yoy < -25) A.flags.red.push(`${rt.label} PAT ${fmtPct(rt.rows.PAT.yoy)} YoY`);
    if (rt.rows.PAT.yoy != null && rt.rows.PAT.yoy > 40) A.flags.green.push(`${rt.label} PAT ${fmtPct(rt.rows.PAT.yoy)} YoY`);
    if (rt.margin.cur < rt.margin.ya - 5) A.flags.red.push(`${rt.label} EBITDA margin ${rt.margin.cur.toFixed(0)}% vs ${rt.margin.ya.toFixed(0)}% a year ago`);
    const oi = F.q.other_inc ? F.q.other_inc[F.q.other_inc.length - 1] : null;
    if (oi != null && rt.rows.PBT.cur > 0 && oi / rt.rows.PBT.cur > 0.2) A.flags.red.push(`Other income is ${Math.round((oi / rt.rows.PBT.cur) * 100)}% of ${rt.label} PBT; check for one-offs`);
  }
  // balance sheet
  const bs = F.bs, bl = F.bs_labels || [];
  if (bs) {
    const n = bl.length - 1;
    const de = bs.borrowings[n] / bs.equity[n];
    A.balance.push({ k: "Debt / equity", v: `${de.toFixed(2)}× (${bl[n]})` });
    A.balance.push({ k: "Borrowings", v: `₹${bs.borrowings[n].toLocaleString("en-IN")} cr (3y ago ₹${bs.borrowings[Math.max(0, n - 3)].toLocaleString("en-IN")} cr)` });
    A.balance.push({ k: "Capital work-in-progress", v: `₹${bs.cwip[n].toLocaleString("en-IN")} cr = ${Math.round((bs.cwip[n] / bs.fixed_assets[n]) * 100)}% of fixed assets` });
    if (de < 0.1) A.flags.green.push(`Effectively debt-free (D/E ${de.toFixed(2)})`);
    if (de > 1) A.flags.red.push(`Leverage ${de.toFixed(1)}× equity`);
    if (bs.borrowings[n] > 2.5 * bs.borrowings[Math.max(0, n - 3)] && bs.borrowings[n] > 200) A.flags.red.push(`Borrowings up ${(bs.borrowings[n] / bs.borrowings[Math.max(0, n - 3)]).toFixed(1)}× in 3 years`);
  }
  // cash quality
  const cf = F.cf, cl = F.cf_labels || [];
  if (cf && y.pat) {
    const n = cl.length - 1;
    const patFor = (lab) => { const i = yl.indexOf(lab); return i >= 0 ? y.pat[i] : null; };
    const yrs = [n - 2, n - 1, n].filter((i) => i >= 0);
    const cfo3 = sum(yrs.map((i) => cf.cfo[i])), pat3 = sum(yrs.map((i) => patFor(cl[i]) || 0));
    const conv = pat3 ? (cfo3 / pat3) * 100 : null;
    A.cash.push({ k: "CFO / PAT (3y)", v: conv != null ? `${conv.toFixed(0)}%` : "—", bad: conv != null && conv < 60, good: conv != null && conv >= 90 });
    A.cash.push({ k: `Operating cash flow ${cl[n]}`, v: `₹${cf.cfo[n].toLocaleString("en-IN")} cr vs PAT ₹${(patFor(cl[n]) ?? 0).toLocaleString("en-IN")} cr` });
    const fcf = cf.fcf ? cf.fcf[n] : cf.cfo[n] + (cf.cfi ? cf.cfi[n] : 0);
    A.cash.push({ k: cf.fcf ? `Free cash flow ${cl[n]}` : `CFO + CFI ${cl[n]}`, v: `₹${Math.round(fcf).toLocaleString("en-IN")} cr`, bad: fcf < 0 });
    if (conv != null && conv < 0) A.flags.red.push(`Operating cash flow negative over 3 years (₹${cfo3.toLocaleString("en-IN")} cr) despite ₹${pat3.toLocaleString("en-IN")} cr of reported profit`);
    else if (conv != null && conv < 60) A.flags.red.push(`Weak cash conversion: only ${conv.toFixed(0)}% of 3y profit became operating cash`);
    if (conv != null && conv >= 90) A.flags.green.push(`Profits convert to cash (${conv.toFixed(0)}% CFO/PAT, 3y)`);
    if (cf.cff && cf.cff[n] > 0 && fcf < 0) A.flags.red.push(`Growth funded externally: ₹${cf.cff[n].toLocaleString("en-IN")} cr financing inflow in ${cl[n]}`);
  }
  if (F.wc) {
    const w = F.wc.wc_days, n = w.length - 1;
    A.cash.push({ k: "Working-capital days", v: `${w[n]} (from ${w[n - 1]} a year ago, ${w[n - 3]} 3y ago)`, bad: w[n] > w[n - 1] * 1.4 });
    if (w[n] > w[n - 1] * 1.4) A.flags.red.push(`Working-capital days jumped ${w[n - 1]} → ${w[n]}`);
  }
  // bull / bear: built only from computed facts above (no outside knowledge)
  A.bull = A.flags.green.slice();
  A.bear = A.flags.red.slice();
  return A;
}

export function fmtPct(v, d = 1) {
  if (v == null || !isFinite(v)) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(v).toFixed(d)}%`;
}

// Required H2 growth to hit a full-year target, used by promised-vs-delivered.
export function requiredH2(F, fyTargetPct) {
  const yl = F.y_labels, i = yl.indexOf("FY26");
  if (i < 0) return null;
  const fy = F.y.sales[i] * (1 + fyTargetPct / 100);
  const n = F.q_labels.length - 1;
  const h1 = F.q.sales[n] + F.q.sales[n - 1];
  const h2prev = F.q.sales[n - 2] + F.q.sales[n - 3];
  return pct(fy - h1, h2prev);
}

// ---------------------------------------------------------------- NETWORK
export function makeNet(N) {
  const alias = {};
  for (const [canon, al] of Object.entries(N.org_aliases || {})) { alias[canon.toLowerCase()] = canon; for (const a of al) alias[a.toLowerCase()] = canon; }
  const canon = (o) => alias[(o || "").toLowerCase()] || o;
  const byId = Object.fromEntries(N.contacts.map((c) => [c.id, c]));
  return { ...N, canon, byId };
}

function spanOverlap(a, b) {
  const NOW = 2026;
  const fill = (e) => {
    if (e.from == null && e.to == null) return null;            // years unknown
    if (e.from == null) return { f: e.to - 8, t: e.to, inferred: true }; // known end only: assume ~8y tenure
    return { f: e.from, t: e.to ?? NOW, inferred: !!e.approx };
  };
  const A = fill(a), B = fill(b);
  if (!A || !B) return { unknown: true, years: 0 };
  const yrs = Math.min(A.t, B.t) - Math.max(A.f, B.f);
  return { years: Math.max(0, yrs), inferred: A.inferred || B.inferred };
}

// How is contact c connected to person p (public registry entry)? Returns best link.
export function directLink(net, c, p) {
  let best = null;
  for (const ce of c.career || []) {
    for (const pe of p.career || []) {
      if (net.canon(ce.org) !== net.canon(pe.org)) continue;
      const ov = spanOverlap(ce, pe);
      let kind, w;
      if (ov.unknown) { kind = "same firm (years not public)"; w = 0.3; }
      else if (ov.years > 0 && !ov.inferred) { kind = "worked together"; w = Math.min(1, 0.6 + ov.years * 0.1); }
      else if (ov.years > 0) { kind = "likely overlapped"; w = 0.6; }
      else { kind = "same firm, different years"; w = 0.25; }
      const words = (pe.title || "").toLowerCase().match(/[a-z]{6,}/g) || [];
      if (ce.note && words.some((wd) => ce.note.toLowerCase().includes(wd)) && ov.years > 0) { kind = ov.inferred ? "same team, likely overlapped" : "same team"; w = Math.min(1, w + 0.25); }
      const board = /independent director|non-executive|chairman|chairperson/i.test(pe.title || "") && !/independent director|chairman|board/i.test(ce.title || "");
      if (board && ov.years > 0) { kind = "on the board of their employer"; w = 0.35; }
      if (ce.org === pe.org) w += 0.001;
      const subj = c.name === "You" ? "You were" : `${c.name.split(" ")[0]} was`;
      const why = `${subj} at ${ce.org} ${ce.from ?? "?"}–${ce.to ?? "now"}${ce.note ? ` (${ce.note})` : ""}; ${p.name}${pe.title ? ", " + pe.title + "," : ""} ${pe.from ? pe.from + "–" + (pe.to ?? "now") : pe.to ? "until " + pe.to : "(dates not public)"}${pe.approx ? " (approx.)" : ""}`;
      if (!best || w > best.w) best = { kind, w, why, org: net.canon(ce.org) };
    }
  }
  for (const ed of c.education || []) for (const pd of p.education || []) {
    if (ed.school && pd.school && ed.school === pd.school) {
      const close = ed.year && pd.year && Math.abs(ed.year - pd.year) <= 2;
      const w = close ? 0.55 : 0.2;
      if (!best || w > best.w) best = { kind: close ? "studied together" : "same alma mater", w, why: `Both ${ed.school}` };
    }
  }
  return best;
}

const recency = (last, asof) => { const d = daysBetween(last, asof); return d < 90 ? 1 : d < 365 ? 0.85 : 0.65; };

export function pathsToPerson(net, p, asof) {
  const out = [];
  // you yourself
  const meLink = directLink(net, { name: "You", ...net.me }, p);
  if (meLink) out.push({ degree: 0, score: meLink.w, path: ["You"], link: meLink });
  for (const c of net.contacts) {
    const l = directLink(net, c, p);
    if (l) out.push({ degree: 1, score: l.w * (c.strength / 5) * recency(c.last, asof), path: ["You", c.id], via: c, link: l });
  }
  // second degree: you -> A -> B -> p
  for (const a of net.contacts) for (const [bid, es] of a.knows || []) {
    const b = net.byId[bid];
    if (!b) continue;
    const l = directLink(net, b, p);
    if (!l) continue;
    out.push({ degree: 2, score: l.w * (a.strength / 5) * (es / 5) * 0.8, path: ["You", a.id, b.id], via: a, target: b, link: l });
  }
  const direct = new Set(out.filter((x) => x.degree === 1 && x.score >= 0.2).map((x) => x.via.id));
  const seen = new Set();
  return out.filter((x) => !(x.degree === 2 && direct.has(x.target.id))).sort((x, y) => y.score - x.score).filter((x) => { const k = x.path.join(">"); if (seen.has(k)) return false; seen.add(k); return true; });
}

export const SECTOR_TAGS = {
  KAYNES: ["semiconductors", "OSAT", "EMS", "smart meters", "test & packaging"], PIIND: ["agrochemicals", "CSM", "global crop protection", "specialty chemicals"],
  SUNPHARMA: ["pharma quality", "USFDA", "pharma regulatory", "regulatory"], HDFCBANK: ["private banks", "bank compliance", "RBI regulation", "credit risk", "bank supervision"],
  ICICIBANK: ["private banks", "bank compliance", "RBI regulation", "credit risk"], BAJFINANCE: ["NBFCs", "consumer credit", "QIPs", "ECM"],
  ASIANPAINT: ["decorative paints", "dealer channel", "new entrants"], TITAN: ["jewellery", "gold", "D2C", "retail"], LT: ["metro rail", "EPC", "infrastructure"],
  DEEPAKNTR: ["specialty chemicals", "phenolics", "chemical plants"], CLEAN: ["specialty chemicals", "catalysis", "green chemistry"], DIXON: ["EMS", "mobile manufacturing", "PLI"],
  POLYCAB: ["cables & wires", "electricals", "dealer channel"], CDSL: ["market infrastructure", "depositories", "broking"], INDIGO: ["aviation", "airlines"],
  TRENT: ["value retail", "apparel"], RELIANCE: ["telecom", "digital", "conglomerates"], TCS: ["IT services", "enterprise AI"],
};

// Who in my network is best placed to explain company `sym`?
export function whoToCall(net, sym, asof, context = "") {
  const res = [];
  const tags = SECTOR_TAGS[sym] || [];
  for (const c of net.contacts) {
    let score = 0, why = [], kind = null, caution = null;
    for (const e of c.career || []) {
      const org = net.canon(e.org);
      if (net.org_company[org] === sym || net.org_company[e.org] === sym) {
        const rel = (net.org_relation[org] || net.org_relation[e.org] || {})[sym];
        if (rel) { const w = 0.6; if (w > score) { score = w; kind = "adjacent"; why = [`${rel}: ${e.title} at ${org}${e.to ? ` (${e.from}–${e.to})` : " (current)"}`]; } }
        else if (e.to == null) { if (0.85 > score) { score = 0.85; kind = "insider"; why = [`Works there now: ${e.title}`]; caution = "Current employee. Stick to public-domain context and don't ask for unpublished price-sensitive information."; } }
        else { const left = 2026 - e.to; const w = left <= 3 ? 1 : 0.8; if (w > score) { score = w; kind = "alumnus"; why = [`${e.title}, ${e.from}–${e.to}; left ${left <= 1 ? "recently" : left + " years ago"}`]; } }
      }
    }
    const hits = (c.tags || []).filter((t) => tags.includes(t));
    if (hits.length) { const w = 0.3 + 0.1 * hits.length; if (score === 0) { score = w; kind = "expert"; why = [`Sector expertise: ${hits.join(", ")}`]; } else { score += 0.05 * hits.length; why.push(`also knows ${hits.join(", ")}`); } }
    if (!score) continue;
    res.push({ c, kind, why, caution, score: score * (0.5 + c.strength / 10) * recency(c.last, asof) });
  }
  return res.sort((a, b) => b.score - a.score);
}

export function expertiseMap(net) {
  return Object.entries(net.themes).map(([theme, tags]) => ({
    theme,
    people: net.contacts.map((c) => ({ c, hits: (c.tags || []).filter((t) => tags.includes(t)).length })).filter((x) => x.hits)
      .sort((a, b) => b.hits * b.c.strength - a.hits * a.c.strength),
  })).filter((t) => t.people.length).sort((a, b) => b.people.length - a.people.length);
}

// Reasons to reconnect: dormant contacts whose (former) employer or close peer just had a material event.
export function reconnect(net, filings, asof, minDays = 120) {
  const out = [];
  for (const c of net.contacts) {
    const idle = daysBetween(c.last, asof);
    if (idle < minDays) continue;
    const syms = new Map();
    for (const e of c.career || []) { const s = net.org_company[net.canon(e.org)] || net.org_company[e.org]; if (s) syms.set(s, e); }
    let best = null;
    for (const f of filings) {
      if (!syms.has(f.sym) || f.priority < 50) continue;
      if (!best || f.priority > best.f.priority) best = { f, e: syms.get(f.sym) };
    }
    if (best) out.push({ c, idle, f: best.f, e: best.e, score: best.f.priority * (c.strength / 5) * Math.min(1.5, idle / 180) });
  }
  return out.sort((a, b) => b.score - a.score);
}

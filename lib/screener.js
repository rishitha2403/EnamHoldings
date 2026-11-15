// Fetch + parse a screener.in company page into FINN's normalised fundamentals schema.
// Works for any NSE/BSE company that screener covers (consolidated first, standalone fallback).
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (compatible; FINN-research/1.0; +https://github.com/)";
const num = (t) => {
  if (t == null) return null;
  const s = String(t).replace(/[,₹%\s]|Cr\.?/g, "").replace(/ /g, "");
  if (s === "" || s === "-") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const clean = (t) => String(t || "").replace(/ /g, " ").replace(/\+/g, "").replace(/\s+/g, " ").trim();
const fy = (l) => { const m = /^Mar (\d{4})$/.exec(l); return m ? "FY" + m[1].slice(2) : l; };

const HEAD = { quarters: /quarterly results/i, "profit-loss": /profit (&|and) loss/i, "balance-sheet": /balance sheet/i, "cash-flow": /cash flows?/i, ratios: /^ratios$/i };
function table($, sectionId) {
  let t = $(`section#${sectionId} table, #${sectionId} table`).first();
  if (!t.length && HEAD[sectionId]) {
    // fallback: first table after a heading with the section's title
    const h = $("h2").filter((i, el) => HEAD[sectionId].test(clean($(el).text()))).first();
    if (h.length) t = h.closest("section, div").find("table").first();
  }
  if (!t.length) return null;
  const heads = t.find("thead th").map((i, th) => clean($(th).text())).get().slice(1);
  const rows = {};
  t.find("tbody tr").each((i, tr) => {
    const tds = $(tr).find("td");
    const label = clean($(tds[0]).text());
    if (!label || /raw pdf/i.test(label)) return;
    rows[label] = tds.slice(1).map((j, td) => num($(td).text())).get();
  });
  return { heads, rows };
}
const pick = (rows, ...names) => { for (const n of names) for (const k of Object.keys(rows)) if (k.toLowerCase() === n.toLowerCase()) return rows[k]; return null; };

function parse(html, sym) {
  const $ = cheerio.load(html);
  const F = { sym, name: clean($("h1").first().text()) || sym };
  let ratioLis = $("#top-ratios li");
  if (!ratioLis.length) ratioLis = $("li").filter((i, li) => /^(market cap|current price|stock p\/e|roce|roe|book value|high \/ low|dividend yield)/i.test(clean($(li).text())));
  ratioLis.each((i, li) => {
    const nameEl = $(li).find(".name");
    const k = clean(nameEl.length ? nameEl.text() : $(li).text()).toLowerCase();
    const nums = $(li).find(".number").length ? $(li).find(".number").map((j, x) => num($(x).text())).get() : (clean($(li).text()).match(/[\d,]+(\.\d+)?/g) || []).map(num);
    const v = nums[0], v2 = nums[1];
    if (k.startsWith("market cap")) F.mcap_cr = v;
    else if (k.startsWith("current price")) F.price = v;
    else if (k.startsWith("stock p/e")) F.pe = v;
    else if (k.startsWith("book value")) F.book = v;
    else if (k.startsWith("roce")) F.roce = v;
    else if (k.startsWith("roe")) F.roe = v;
    else if (k.startsWith("dividend yield")) F.div_yield = v;
    else if (k.startsWith("high / low")) { F.hi52 = v; F.lo52 = v2; }
  });
  $(".about sup").remove();
  F.about = clean($(".company-profile .about p, .about p").first().text()).slice(0, 400);

  const q = table($, "quarters");
  if (q) {
    F.q_labels = q.heads;
    const r = q.rows;
    F.q = { sales: pick(r, "Sales", "Revenue"), ebitda: pick(r, "Operating Profit", "Financing Profit"), opm: pick(r, "OPM %", "Financing Margin %"),
      other_inc: pick(r, "Other Income"), interest: pick(r, "Interest"), dep: pick(r, "Depreciation"), pbt: pick(r, "Profit before tax"), tax: pick(r, "Tax %"), pat: pick(r, "Net Profit") };
  }
  const pl = table($, "profit-loss");
  if (pl) {
    F.y_labels = pl.heads.map(fy);
    const r = pl.rows;
    F.y = { sales: pick(r, "Sales", "Revenue"), ebitda: pick(r, "Operating Profit", "Financing Profit"), opm: pick(r, "OPM %", "Financing Margin %"), pbt: pick(r, "Profit before tax"), pat: pick(r, "Net Profit") };
  }
  const bs = table($, "balance-sheet");
  if (bs) {
    F.bs_labels = bs.heads.map(fy);
    const r = bs.rows, eq = pick(r, "Equity Capital") || [], res = pick(r, "Reserves") || [];
    F.bs = { equity: eq.map((v, i) => (v || 0) + (res[i] || 0)), borrowings: pick(r, "Borrowings", "Borrowing") || eq.map(() => 0), fixed_assets: pick(r, "Fixed Assets") || eq.map(() => 0),
      cwip: pick(r, "CWIP") || eq.map(() => 0), investments: pick(r, "Investments") || eq.map(() => 0) };
  }
  const cf = table($, "cash-flow");
  if (cf) {
    F.cf_labels = cf.heads.map(fy);
    const r = cf.rows;
    F.cf = { cfo: pick(r, "Cash from Operating Activity"), cfi: pick(r, "Cash from Investing Activity"), cff: pick(r, "Cash from Financing Activity"), fcf: pick(r, "Free Cash Flow") };
    if (!F.cf.fcf) delete F.cf.fcf;
  }
  const ra = table($, "ratios");
  if (ra) {
    const r = ra.rows;
    const wc = pick(r, "Working Capital Days");
    if (wc && wc.length >= 4) F.wc = { debtor_days: pick(r, "Debtor Days"), inventory_days: pick(r, "Inventory Days"), payable_days: pick(r, "Days Payable"), wc_days: wc, roce: pick(r, "ROCE %") };
  }
  // primary documents
  const concalls = [];
  $(".documents.concalls li, .concalls li").each((i, li) => {
    const date = clean($(li).find("div").first().text());
    const a = $(li).find("a").filter((j, x) => /transcript/i.test($(x).text())).first();
    if (a.length) concalls.push({ date, url: a.attr("href") });
  });
  if (!concalls.length) {
    // fallback: any "Transcript" link; date = nearest month-year text in its parent row
    $("a").filter((j, x) => /^transcript$/i.test(clean($(x).text()))).each((j, a) => {
      const m = clean($(a).parent().text()).match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/);
      concalls.push({ date: m ? m[0] : "", url: $(a).attr("href") });
    });
  }
  const ars = [];
  $(".documents.annual-reports a, .annual-reports a").each((i, a) => {
    const t = clean($(a).clone().children().remove().end().text()) || clean($(a).text());
    const href = $(a).attr("href");
    if (href && /year/i.test(t)) ars.push({ year: t.replace(/Financial Year/i, "FY").trim(), url: href });
  });
  F.docs = { concalls, annual_reports: ars };
  return F;
}

async function fetchCompany(sym) {
  sym = String(sym || "").toUpperCase().replace(/[^A-Z0-9&-]/g, "");
  if (!sym) throw Object.assign(new Error("bad symbol"), { status: 400 });
  let last;
  for (const path of [`/company/${sym}/consolidated/`, `/company/${sym}/`]) {
    const r = await fetch("https://www.screener.in" + path, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
    if (r.status === 404) { last = 404; continue; }
    if (!r.ok) throw Object.assign(new Error(`screener ${r.status}`), { status: 502 });
    const F = parse(await r.text(), sym);
    if (F.q && F.q.sales && F.q.sales.some((v) => v)) { F.source = "https://www.screener.in" + path; F.asof = new Date().toISOString().slice(0, 10); return F; }
    last = "empty";
  }
  throw Object.assign(new Error(last === 404 ? "Ticker not found on screener.in" : "No financials found"), { status: 404 });
}

module.exports = { parse, fetchCompany, num, clean };

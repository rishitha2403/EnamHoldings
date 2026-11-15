import * as E from "./engine.js";

// ------------------------------------------------------------------ state
const S = { view: "today", win: 24, sym: null, seg: "overview", cfg: null, live: {}, guidanceLive: {} };
const DEF_CFG = { pricePct: 5, volX: 2, watch: ["results", "M&A", "management_change", "litigation", "fund_raise", "capex", "credit_rating", "pledging"] };
const store = {
  get(k, d) { try { const v = localStorage.getItem("finn." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("finn." + k, JSON.stringify(v)); } catch {} },
};
S.cfg = { ...DEF_CFG, ...store.get("cfg", {}) };
let D; // data bundle
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const pc = (v, d = 1) => `<span class="${v > 0 ? "up" : v < 0 ? "dn" : "mu"}">${E.fmtPct(v, d)}</span>`;
const CAT = { results: "Results", "M&A": "M&A / JV", management_change: "Management", fund_raise: "Fund raise", litigation: "Regulatory", earnings_call: "Concall", investor_meetings: "Investor meet", credit_rating: "Rating", press_release: "Update", postal_ballot: "Postal ballot", agm_egm: "AGM/EGM", unclassified: "Routine", capex: "Capex", dividend: "Dividend", pledging: "Pledge", insider_trading: "Insider" };
const PAL = ["#f2b84b", "#7fd6a8", "#8fb8ff", "#c3a8ff", "#ff9f8f", "#7fd3e6", "#e6c27f", "#b6e67f"];
const colorOf = (s) => PAL[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length];
const initials = (n) => n.replace(/^Prof\.\s*/, "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("");
const av = (name, id = name, size = 26) => `<span class="av" style="background:${colorOf(id)};width:${size}px;height:${size}px">${esc(initials(name))}</span>`;

function when(ts) {
  const asof = new Date(D.snap.asof);
  const t = new Date(ts.length <= 10 ? ts + "T15:30:00+05:30" : ts + "+05:30");
  const h = (asof - t) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  return t.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
const daysAgo = (d) => E.daysBetween(d, D.snap.asof.slice(0, 10));
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), 1800); }

// ------------------------------------------------------------------ boot
async function boot() {
  const get = (f) => fetch("data/" + f).then((r) => r.json());
  const [snap, filings, prices, fund, guidance, people, network] = await Promise.all(
    ["snapshot.json", "filings.json", "prices.json", "fundamentals.json", "guidance.json", "people.json", "network.json"].map(get));
  D = { snap, filings, prices, fund, guidance, people: people.people, net: E.makeNet(network) };
  D.peopleById = Object.fromEntries(D.people.map((p) => [p.id, p]));
  D.names = Object.fromEntries(snap.portfolio.map((p) => [p.sym, p.name]));
  const a = new Date(snap.asof);
  $("#asof").textContent = `${a.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · 08:00 IST snapshot`;
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => (b.dataset.v === "alerts" ? openAlerts() : go(b.dataset.v))));
  $("#askBtn").addEventListener("click", () => openAsk());
  $("#scrim").addEventListener("click", closeSheet);
  $("#xBtn").addEventListener("click", closeSheet);
  document.addEventListener("click", onAction);
  const hash = location.hash.slice(1);
  if (hash.startsWith("research/")) { S.sym = hash.split("/")[1]; go("research"); }
  else if (hash === "network") go("network");
  else go("today");
}

function go(v) {
  S.view = v;
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + v));
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  if (v === "today") renderToday();
  if (v === "research") renderResearch();
  if (v === "network") renderNetwork();
  $("#main").scrollTop = 0;
  history.replaceState(null, "", v === "research" && S.sym ? `#research/${S.sym}` : v === "today" ? "#" : "#" + v);
}

// one delegated handler for every data-act button
function onAction(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, arg } = b.dataset;
  const A = {
    win: () => { S.win = +arg; S.since = ""; renderToday(); },
    research: () => { S.sym = arg; S.seg = b.dataset.seg || "overview"; closeSheet(); go("research"); },
    seg: () => { S.seg = arg; renderResearch(); },
    person: () => openPerson(arg),
    contact: () => openContact(arg),
    calls: () => openCalls(arg),
    unfold: () => { b.closest(".foldwrap").innerHTML = b.closest(".foldwrap").dataset.full; },
    copy: () => { const t = b.closest(".sheet .body, .card")?.querySelector(".draft")?.textContent || ""; navigator.clipboard?.writeText(t).then(() => toast("Draft copied"), () => toast("Copy not available")); },
    ask: () => { openAsk(arg); },
    alerts: () => openAlerts(),
    theme: () => openTheme(arg),
    tab: () => go(arg),
  };
  if (A[act]) { e.preventDefault(); A[act](); }
}

// ------------------------------------------------------------------ TODAY (push)
function inWindow(ts) {
  const asof = new Date(D.snap.asof);
  const t = new Date(ts.length <= 10 ? ts + "T15:30:00+05:30" : ts + "+05:30");
  return (asof - t) / 36e5 <= S.win;
}

function renderToday() {
  const el = $("#v-today");
  const fil = D.filings.filter((f) => inWindow(f.ts));
  const st = E.stories(fil).map((g) => {
    // user's watch-list decides what may be promoted to a full card
    if (!S.cfg.watch.includes(g.category) && g.treatment === "brief") g.treatment = "line";
    return g;
  });
  const briefs = st.filter((g) => g.treatment === "brief").sort((a, b) => b.priority - a.priority);
  const lines = st.filter((g) => g.treatment === "line").sort((a, b) => b.priority - a.priority);
  const folds = st.filter((g) => g.treatment === "fold");
  const allAlerts = E.priceAlerts(D.prices, D.snap.dates, S.cfg, D.filings);
  const lastEod = D.snap.eod;
  const alerts = allAlerts.filter((a) => a.date === lastEod || inWindow(a.date));
  const wins = [[24, "24h"], [72, "3 days"], [168, "7 days"], [336, "14 days"]];
  const nFold = folds.reduce((a, g) => a + g.items.length, 0);
  const tail = [lines.length ? `${lines.length} worth a glance` : "", nFold ? `${nFold} routine filings folded` : ""].filter(Boolean).join(", ");
  const span = S.win <= 24 ? "in the last 24 hours" : S.win <= 72 ? "in the last 3 days" : S.win <= 168 ? "this week" : "in this window";
  const lead = briefs.length
    ? `<em>${briefs.length} ${briefs.length === 1 ? "item needs" : "items need"} your attention</em> ${span}. ${tail ? tail.charAt(0).toUpperCase() + tail.slice(1) + "." : ""}`
    : `<em>Nothing material</em> ${span}. ${tail ? tail.charAt(0).toUpperCase() + tail.slice(1) + "." : ""}`;
  const weekend = S.win <= 24 ? `<p class="sub" style="margin-top:-6px">Markets were shut Sat–Sun, so only late filings land overnight. Results season ran all week: <button class="acc" data-act="win" data-arg="168">see the week →</button></p>` : "";
  S.calledSyms = new Set();

  el.innerHTML = `
    <h1 class="hero">${lead}</h1>
    <p class="sub">${D.snap.portfolio.length} holdings · ${fil.length} filings · prioritised for you</p>${weekend}
    <div class="chips">${wins.map(([h, l]) => `<button class="chip ${S.win === h ? "on" : ""}" data-act="win" data-arg="${h}">${l}</button>`).join("")}
      <label class="chip ${![24, 72, 168, 336].includes(S.win) ? "on" : ""}" style="display:inline-flex;align-items:center;gap:4px">Since <input type="date" id="since" min="2026-11-01" max="2026-11-15" value="${S.since || ""}" style="background:none;border:0;color:inherit;font:inherit;width:118px"></label>
      <button class="chip ghost" data-act="alerts">±${S.cfg.pricePct}% · ${S.cfg.volX}× vol ⚙</button></div>

    <div class="sec"><h2>Unusual moves</h2><span class="c">${alerts.length ? `${alerts.length} triggered` : "none triggered"}</span><button class="r" data-act="alerts">Thresholds</button></div>
    ${renderAlerts(alerts, allAlerts)}

    <div class="sec"><h2>Needs you</h2><span class="c">${briefs.length}</span></div>
    ${briefs.length ? briefs.map(cardFor).join("") + (S.win < 168 ? `<button class="fold" data-act="win" data-arg="168" style="width:100%">Weekend view: see the full week of results season <span class="acc" style="margin-left:auto">7 days →</span></button>` : "") : `<div class="empty">Nothing material in the last ${S.win}h. <button class="acc" data-act="win" data-arg="168">Widen to 7 days →</button></div>`}

    ${lines.length ? `<div class="sec"><h2>Worth a glance</h2><span class="c">${lines.length}</span></div>${lines.map(lineFor).join("")}` : ""}

    ${nFold ? `<div class="sec"><h2>Routine</h2></div>${foldFor(folds)}` : ""}

    ${reconnectBlock(2)}
    <p class="srcnote">Sources: NSE corporate announcements API, screener.in fundamentals and EOD price/volume. Every card links to its exchange filing. Network contacts are synthetic demo data.</p>`;
  const si = $("#since");
  if (si) si.onchange = () => { if (!si.value) return; S.since = si.value; S.win = Math.max(1, Math.round((new Date(D.snap.asof) - new Date(si.value + "T00:00:00+05:30")) / 36e5)); renderToday(); };
}

function renderAlerts(alerts, all) {
  if (!alerts.length) {
    const near = E.priceAlerts(D.prices, D.snap.dates, { pricePct: 0, volX: 0 }, D.filings).filter((a) => a.date === D.snap.eod)
      .sort((a, b) => Math.abs(b.chg) / S.cfg.pricePct + b.vr / S.cfg.volX - (Math.abs(a.chg) / S.cfg.pricePct + a.vr / S.cfg.volX)).slice(0, 3);
    return `<div class="card"><div class="small">No holding crossed ±${S.cfg.pricePct}% or ${S.cfg.volX}× volume at the ${D.snap.eod.slice(8)} Nov close. Closest to your thresholds:</div>
      <div class="alerts" style="margin-top:8px">${near.map((a) => alertTile(a, true)).join("")}</div></div>`;
  }
  return `<div class="alerts">${alerts.slice(0, 12).map((a) => alertTile(a)).join("")}</div>`;
}
function alertTile(a, quiet) {
  const f = a.explainedBy && D.filings.find((x) => x.id === a.explainedBy);
  const d = new Date(a.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const exp = quiet ? "" : f ? `After: ${esc(f.title.slice(0, 64))}${f.title.length > 64 ? "…" : ""}` : `<span class="nofil">No filing explains this.</span> Worth a call.`;
  return `<button class="al ${a.severity > 60 ? "sev" : ""}" data-act="research" data-arg="${a.sym}" style="text-align:left">
    <div class="hd"><span class="tk">${a.sym}</span><span class="when">${d}</span></div>
    <div class="big ${a.chg > 0 ? "up" : "dn"}">${E.fmtPct(a.chg)}</div>
    <div class="x">${a.vr.toFixed(1)}× avg volume · ₹${inr(a.close)}</div>
    ${exp ? `<div class="exp">${exp}</div>` : ""}</button>`;
}

function head(g) {
  return `<div class="hd"><span class="pill ${g.category}">${CAT[g.category] || g.category}</span><span class="co">${esc(D.names[g.sym] || g.sym)}</span><span class="when">${when(g.ts)}</span></div>`;
}

function cardFor(g) {
  const f = g.items[0];
  const why = g.items.map((x) => x.why).find(Boolean) || f.summary;
  let body = "";
  if (g.category === "results") body = resultsBlock(g);
  const persons = g.people.map((id) => D.peopleById[id]).filter((p) => p && p.company === g.sym);
  if (g.category === "management_change" && persons.length) body += persons.map((p) => personBlock(p)).join("");
  else if (persons.length) body += persons.slice(0, 1).map((p) => personBlock(p, true)).join("");
  if (g.category !== "management_change" && !S.calledSyms.has(g.sym)) { body += callBlock(g.sym, 2); S.calledSyms.add(g.sym); }
  const flags = g.flags.map((x) => `<div class="flag">${esc(x)}</div>`).join("");
  const more = g.items.length > 1 ? `<div class="small" style="margin-top:6px">+${g.items.length - 1} related filing${g.items.length > 2 ? "s" : ""}: ${g.items.slice(1).map((x) => esc(x.title.slice(0, 48))).join(" · ")}</div>` : "";
  const hasResearch = D.fund[g.sym];
  return `<article class="card ${g.priority >= 85 ? "hot" : ""}">${head(g)}
    <div class="ttl">${esc(f.title)}</div>
    ${why ? `<div class="why">${esc(why)}</div>` : ""}${flags}${body}${more}
    <div class="acts"><a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">Filing ↗</a>
      <button class="btn ${hasResearch ? "pri" : ""}" data-act="research" data-arg="${g.sym}" ${D.guidance[g.sym] ? 'data-seg="promises"' : ""}>${D.guidance[g.sym] ? "Promised vs delivered →" : "Research →"}</button>
      <button class="btn" data-act="calls" data-arg="${g.sym}">Who else?</button></div></article>`;
}

function resultsBlock(g) {
  const F = D.fund[g.sym];
  const rt = F && E.resultsTable(F);
  if (!rt || rt.label !== "Sep 2026") {
    const last = rt ? ` Last parsed quarter: ${rt.label} (PAT ${E.fmtPct(rt.rows.PAT.yoy)} YoY, EBITDA margin ${rt.margin.cur.toFixed(1)}%).` : "";
    return `<div class="dlv" style="margin-top:10px"><b>Headline numbers</b>Filed ${when(g.ts)}; the numbers parser hasn't run in this snapshot yet. Revenue, EBITDA, PBT and PAT will appear here.${last}</div>`;
  }
  const r = rt.rows;
  const tr = (k) => `<tr><td>${k}</td><td>₹${inr(r[k].cur)}</td><td>${pc(r[k].qoq)}</td><td>${pc(r[k].yoy)}</td></tr>`;
  return `<table class="rt"><thead><tr><th>₹ cr · ${rt.label.replace("Sep 2026", "Q2 FY27")}</th><th>Actual</th><th>QoQ</th><th>YoY</th></tr></thead>
    <tbody>${["Revenue", "EBITDA", "PBT", "PAT"].map(tr).join("")}</tbody></table>
    <div class="small">EBITDA margin ${rt.margin.cur.toFixed(1)}% · ${rt.margin.prev.toFixed(1)}% last qtr · ${rt.margin.ya.toFixed(1)}% a year ago</div>`;
}

function pathHtml(x) {
  const ids = x.path.slice(1);
  const nodes = [`<span class="av" style="background:#e9edf1">You</span>`].concat(ids.map((id) => `<span style="display:inline-flex;align-items:center;gap:4px">${av(D.net.byId[id].name, id)}<span class="small" style="color:var(--tx2)">${esc(D.net.byId[id].name.replace(/^Prof\.\s*/, "").split(" ")[0])}</span></span>`));
  return `<div class="path">${nodes.join('<span class="arrow">→</span>')}<span class="arrow">→</span><b>${esc(x.person ? x.person.name : "")}</b></div>`;
}

function personBlock(p, compact) {
  const paths = E.pathsToPerson(D.net, p, D.snap.asof).filter((x) => x.degree > 0).slice(0, compact ? 1 : 2);
  const pathsHtml = paths.length
    ? paths.map((x) => `<div style="margin:6px 0 8px">${pathHtml({ ...x, person: p })}
        <div class="link-why"><span class="kind">${x.degree === 1 ? "1st" : "2nd"} · ${esc(x.link.kind)}</span> ${esc(x.link.why)}</div></div>`).join("")
    : `<div class="small">No one in your network overlaps with ${esc(p.name)} yet.</div>`;
  return `<div class="netbox"><div class="lab">${compact ? "Key person" : "Who is " + esc(p.name.split(" ").slice(-1)[0]) + "?"}<span class="lock">🔒 matched on-device</span></div>
    ${compact ? "" : `<div style="font-size:13.5px;color:var(--tx2)">${esc(p.bio)}</div>`}
    <div class="lab" style="margin-top:10px">Your way in</div>${pathsHtml}
    <div class="acts" style="margin-top:4px"><button class="btn" data-act="person" data-arg="${p.id}">Profile & questions to ask</button></div></div>`;
}

function callBlock(sym, n) {
  const calls = E.whoToCall(D.net, sym, D.snap.asof).slice(0, n);
  if (!calls.length) return "";
  return `<div class="netbox"><div class="lab">Best placed to give you context<span class="lock">🔒 on-device</span></div>
    ${calls.map((x) => `<button class="call" data-act="contact" data-arg="${x.c.id}" style="text-align:left;width:100%">${av(x.c.name, x.c.id)}
      <div><b>${esc(x.c.name)}</b> <span class="small">· ${esc(x.c.headline)}</span><div class="link-why">${esc(x.why.join("; "))}</div>
      ${x.caution ? `<div class="caution">${esc(x.caution)}</div>` : ""}</div></button>`).join("")}</div>`;
}

function lineFor(g) {
  const f = g.items[0];
  const w = g.items.map((x) => x.why).find(Boolean) || f.summary || "";
  return `<div class="line"><span class="tkb">${g.sym}</span><div style="flex:1"><div class="t">${esc(f.title)}</div>
    ${w ? `<div class="w">${esc(w.length > 150 ? w.slice(0, 148) + "…" : w)}</div>` : ""}
    <div class="w"><span class="pill">${CAT[g.category] || g.category}</span> ${when(g.ts)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">filing ↗</a>${g.items.length > 1 ? ` · ${g.items.length} filings` : ""}</div></div></div>`;
}

function foldFor(folds) {
  const byCat = {};
  for (const g of folds) for (const f of g.items) (byCat[g.category] = byCat[g.category] || []).push(f);
  const summary = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length).map(([c, a]) => `${CAT[c] || c} ${a.length}`).join(" · ");
  const full = Object.values(byCat).flat().sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .map((f) => `<div class="line"><span class="tkb">${f.sym}</span><div><div class="t" style="font-size:13px">${esc(f.title)}</div><div class="w">${when(f.ts)} · <a href="${esc(f.url)}" target="_blank" rel="noopener">filing ↗</a></div></div></div>`).join("");
  return `<div class="foldwrap" data-full="${esc(full)}"><button class="fold" data-act="unfold" style="width:100%;text-align:left"><b>${Object.values(byCat).flat().length} hidden</b> · ${esc(summary)} <span class="acc" style="margin-left:auto">Show</span></button></div>`;
}

function reconnectBlock(n) {
  const r = E.reconnect(D.net, D.filings, D.snap.asof).slice(0, n);
  if (!r.length) return "";
  return `<div class="sec"><h2>Reasons to reconnect</h2><button class="r" data-act="tab" data-arg="network">All →</button></div>
    ${r.map((x) => `<button class="card" data-act="contact" data-arg="${x.c.id}" style="display:flex;gap:10px;text-align:left;width:100%">${av(x.c.name, x.c.id, 34)}
      <div><div><b>${esc(x.c.name)}</b> <span class="small">· last spoke ${x.idle} days ago</span></div>
      <div class="why" style="margin-top:2px">${esc(x.e.to ? `Ex-${x.e.org}` : x.e.org)}: ${esc(D.names[x.f.sym] || x.f.sym)} just filed “${esc(x.f.title.slice(0, 60))}${x.f.title.length > 60 ? "…" : ""}”</div></div></button>`).join("")}`;
}

// ------------------------------------------------------------------ RESEARCH (pull)
async function getCompany(sym) {
  if (D.fund[sym]) return { F: D.fund[sym], cached: true };
  if (S.live[sym]) return S.live[sym];
  const r = await fetch(`/api/company?symbol=${encodeURIComponent(sym)}`);
  if (!r.ok) throw new Error(r.status === 404 ? "not-found-or-no-api" : `HTTP ${r.status}`);
  const F = await r.json();
  if (F.error) throw new Error(F.error);
  S.live[sym] = { F, cached: false };
  return S.live[sym];
}

async function renderResearch() {
  const el = $("#v-research");
  const chips = [...D.snap.research].map((s) => `<button class="chip ${S.sym === s ? "on" : ""}" data-act="research" data-arg="${s}">${s}</button>`).join("");
  const top = `<div class="search"><input id="tkr" placeholder="Any NSE ticker, e.g. NAVINFLUOR" value="${S.sym && !D.fund[S.sym] ? esc(S.sym) : ""}" autocomplete="off" autocapitalize="characters"><button class="btn pri" id="go">Analyse</button></div>
    <div class="chips">${chips}<span class="small" style="align-self:center;margin-left:4px">cached · any other ticker runs live</span></div>`;
  if (!S.sym) {
    el.innerHTML = `<h1 class="hero">Research, grounded in <em>what management actually said.</em></h1>
      <p class="sub">Annual reports, concall transcripts and filings only. No broker notes, no news, no model memory.</p>${top}
      <div class="sec"><h2>Start here</h2></div>
      ${D.snap.research.map((s) => { const F = D.fund[s]; const g = D.guidance[s]; const v = g ? g.claims.reduce((a, c) => ((a[c.verdict] = (a[c.verdict] || 0) + 1), a), {}) : null;
        return `<button class="card" data-act="research" data-arg="${s}" style="width:100%;text-align:left"><div class="hd"><span class="co">${esc(F.name)}</span><span class="tk">${s}</span></div>
        <div class="why">${esc(F.about)}</div>${v ? `<div class="small" style="margin-top:6px">Promise tracker: <span class="up">${v.kept || 0} kept</span> · <span class="dn">${v.missed || 0} missed</span> · ${(v.at_risk || 0) + (v.mixed || 0)} at risk/mixed · ${(v.on_track || 0) + (v.too_early || 0)} open</div>` : ""}</button>`; }).join("")}`;
    wireSearch();
    return;
  }
  el.innerHTML = top + `<div class="loading"><span class="spin"></span>Reading ${esc(S.sym)} filings and fundamentals…</div>`;
  wireSearch();
  let C;
  try { C = await getCompany(S.sym); }
  catch (e) {
    el.innerHTML = top + `<div class="err">Couldn't fetch <b>${esc(S.sym)}</b> live. ${e.message === "not-found-or-no-api"
      ? "Either the ticker isn't on NSE/screener, or this deployment is static (live research needs the /api functions; see README → Deploy)."
      : esc(e.message)}</div><p class="sub" style="margin-top:12px">Cached demo companies always work: PIIND, KAYNES, TITAN.</p>`;
    wireSearch();
    return;
  }
  const F = C.F, A = E.analyse(F), G = D.guidance[S.sym] || S.guidanceLive[S.sym];
  const segs = [["overview", "Overview"], ["promises", "Promises"], ["numbers", "Numbers"], ["people", "People"]];
  const vd = G ? G.claims.reduce((a, c) => ((a[c.verdict] = (a[c.verdict] || 0) + 1), a), {}) : null;
  el.innerHTML = top + `
    <div class="co-head" style="margin-top:12px"><div class="nm">${esc(F.name)}</div>
      <div class="meta">${S.sym} · ₹${inr(F.price)} · mcap ₹${inr(F.mcap_cr)} cr ${C.cached ? "· cached snapshot" : "· <span class='acc'>live from screener.in</span>"}</div></div>
    ${vd ? `<div class="score"><div><b class="up">${vd.kept || 0}</b><span>kept</span></div><div><b class="dn">${vd.missed || 0}</b><span>missed</span></div><div><b class="acc">${(vd.at_risk || 0) + (vd.mixed || 0)}</b><span>at risk</span></div><div><b>${(vd.on_track || 0) + (vd.too_early || 0)}</b><span>open</span></div></div>` : ""}
    <div class="seg">${segs.map(([k, l]) => `<button class="${S.seg === k ? "on" : ""}" data-act="seg" data-arg="${k}">${l}</button>`).join("")}</div>
    <div id="rbody"></div>`;
  wireSearch();
  const rb = $("#rbody");
  if (S.seg === "overview") rb.innerHTML = overview(F, A);
  if (S.seg === "promises") rb.innerHTML = G ? promises(F, G) : await livePromises(F);
  if (S.seg === "numbers") rb.innerHTML = numbers(F, A);
  if (S.seg === "people") rb.innerHTML = peopleTab(S.sym);
}
function wireSearch() {
  const i = $("#tkr"), g = $("#go");
  if (!i) return;
  const run = () => { const v = i.value.trim().toUpperCase().replace(/\.NS$/, ""); if (v) { S.sym = v; S.seg = "overview"; go("research"); } };
  g.onclick = run;
  i.onkeydown = (e) => { if (e.key === "Enter") run(); };
}

function overview(F, A) {
  const rt = E.resultsTable(F);
  return `${F.about ? `<p class="why" style="margin:4px 4px 12px">${esc(F.about)}</p>` : ""}
    <div class="kv">${A.snapshot.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join("")}</div>
    <div class="sec"><h2>Quarterly trajectory</h2><span class="c">₹ cr revenue · EBITDA margin</span></div>
    ${barLine(F.q_labels.slice(-9), F.q.sales.slice(-9), F.q.ebitda.slice(-9).map((e, i) => (e / F.q.sales.slice(-9)[i]) * 100))}
    ${rt ? `<div class="card"><table class="rt"><thead><tr><th>${rt.label}</th><th>₹ cr</th><th>QoQ</th><th>YoY</th></tr></thead><tbody>${["Revenue", "EBITDA", "PBT", "PAT"].map((k) => `<tr><td>${k}</td><td>${inr(rt.rows[k].cur)}</td><td>${pc(rt.rows[k].qoq)}</td><td>${pc(rt.rows[k].yoy)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="sec"><h2>Bull vs bear</h2><span class="c">computed from the numbers only</span></div>
    <div class="bb"><div class="col"><h4 class="up">Bull</h4><ul>${A.bull.map((x) => `<li>${esc(x)}</li>`).join("") || "<li class='mu'>No strong positives in the data</li>"}</ul></div>
    <div class="col"><h4 class="dn">Bear</h4><ul>${A.bear.map((x) => `<li>${esc(x)}</li>`).join("") || "<li class='mu'>No red flags in the data</li>"}</ul></div></div>
    ${F.notes ? `<div class="flag" style="margin-top:10px">${esc(F.notes)}</div>` : ""}
    <p class="srcnote">Numbers: screener.in consolidated financials (compiled from exchange filings). The bull and bear lists are generated by rules over those numbers, with no model opinion involved.</p>`;
}

function promises(F, G) {
  const src = Object.fromEntries(G.sources.map((s) => [s.id, s]));
  const extra = S.sym === "PIIND" ? `<div class="card"><div class="small">Even the lowered guidance (“lower single digit” growth) needs H2 FY27 revenue to grow <b class="acc">${E.fmtPct(E.requiredH2(F, 2), 0)}</b> YoY to reach +2% for the year. H1 was ${pc(E.pct(F.q.sales.at(-1) + F.q.sales.at(-2), F.q.sales.at(-5) + F.q.sales.at(-6)))}.</div></div>` : "";
  return `<p class="sub">Every claim is quoted from the company's own transcripts, then checked against reported numbers. ${G.model ? `Extracted live by ${esc(G.model)}.` : "Curated from primary transcripts."}</p>${extra}
    ${G.claims.map((c) => `<div class="claim"><div class="top2"><b style="font-size:14.5px">${esc(c.topic)}</b><span class="vd ${c.verdict}">${c.verdict.replace("_", " ")}</span></div>
      <div class="trail">${c.trail.map((t) => `<div class="q"><i>“${esc(t.quote)}”</i><span class="src">${esc(t.who)} · <a href="${esc(src[t.src]?.url || "#")}" target="_blank" rel="noopener">${esc(src[t.src]?.label || t.src)}${t.page ? `, p.${t.page}` : ""} ↗</a></span></div>`).join("")}</div>
      <div class="dlv"><b>Delivered</b>${esc(c.delivered)}</div>${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}</div>`).join("")}
    <p class="srcnote">Sources: ${G.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}</p>`;
}

async function livePromises(F) {
  const sym = S.sym;
  setTimeout(async () => {
    try {
      const r = await fetch(`/api/guidance?symbol=${encodeURIComponent(sym)}`);
      const g = await r.json();
      if (!r.ok || g.error) throw new Error(g.error || `HTTP ${r.status}`);
      S.guidanceLive[sym] = g;
      if (S.sym === sym && S.seg === "promises") renderResearch();
    } catch (e) {
      const rb = $("#rbody");
      if (rb && S.sym === sym) rb.innerHTML = `<div class="err">Live guidance extraction failed: ${esc(e.message)}. It needs the /api functions and a GEMINI_API_KEY (see README).</div>${transcriptsList(F)}`;
    }
  }, 10);
  return `<div class="loading"><span class="spin"></span>Reading the last 4 concall transcripts and extracting guidance (cheap model), then checking it against reported numbers (stronger model)…</div>${transcriptsList(F)}`;
}
function transcriptsList(F) {
  const t = (F.docs && F.docs.concalls) || [];
  return t.length ? `<div class="sec"><h2>Transcripts found</h2></div>${t.slice(0, 6).map((x) => `<div class="line"><span class="tkb">${esc(x.date)}</span><a class="t" href="${esc(x.url)}" target="_blank" rel="noopener">Transcript ↗</a></div>`).join("")}` : "";
}

function numbers(F, A) {
  const yl = F.y_labels || [];
  const n = yl.length;
  const cfBlock = F.cf ? `<div class="sec"><h2>Do profits turn into cash?</h2><span class="c">₹ cr</span></div>
    ${pairBars(F.cf_labels.slice(-6), F.cf.cfo.slice(-6), F.cf_labels.slice(-6).map((l) => { const i = yl.indexOf(l); return i >= 0 ? F.y.pat[i] : 0; }), "Operating cash flow", "PAT")}` : "";
  return `<div class="sec"><h2>Trajectory</h2></div><div class="rows">${A.trajectory.map((r) => `<div class="r"><span>${esc(r.k)}</span><span>${esc(r.v)}</span></div>`).join("")}</div>
    ${F.y ? barLine(yl.slice(-8), F.y.sales.slice(-8), F.y.opm.slice(-8), "Annual revenue · margin") : ""}
    <div class="sec"><h2>Balance sheet</h2></div><div class="rows">${A.balance.map((r) => `<div class="r"><span>${esc(r.k)}</span><span>${esc(r.v)}</span></div>`).join("")}</div>
    ${cfBlock}
    <div class="sec"><h2>Cash quality</h2></div><div class="rows">${A.cash.map((r) => `<div class="r"><span>${esc(r.k)}</span><span class="${r.bad ? "dn" : r.good ? "up" : ""}">${esc(r.v)}</span></div>`).join("") || `<div class="small">Cash-flow statement not in this snapshot.</div>`}</div>
    ${F.docs ? `<p class="srcnote">Annual reports: ${(F.docs.annual_reports || []).slice(0, 3).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.year)}</a>`).join(" · ")}</p>` : ""}`;
}

function peopleTab(sym) {
  const ppl = D.people.filter((p) => p.company === sym);
  return `<div class="sec"><h2>Who in my network can explain ${esc(sym)}</h2></div>${callBlock(sym, 5).replace('<div class="netbox">', '<div class="card">')}
    ${ppl.length ? `<div class="sec"><h2>Diligence on management</h2></div>${ppl.map((p) => `<button class="person-row" data-act="person" data-arg="${p.id}" style="width:100%;text-align:left">${av(p.name, p.id, 34)}<div><div class="nm">${esc(p.name)}</div><div class="hl">${esc(p.event)}</div></div></button>`).join("")}` : ""}`;
}

// ------------------------------------------------------------------ charts (inline SVG, no libs)
function barLine(labels, bars, line, title = "") {
  const W = 360, H = 150, P = 24, max = Math.max(...bars) * 1.1, lmin = Math.min(...line) - 2, lmax = Math.max(...line) + 2;
  const bw = (W - P * 2) / bars.length;
  const y = (v) => H - 22 - (v / max) * (H - 40), ly = (v) => H - 22 - ((v - lmin) / (lmax - lmin || 1)) * (H - 44);
  const pts = line.map((v, i) => `${P + bw * i + bw / 2},${ly(v)}`).join(" ");
  return `<div class="chart">${title ? `<div class="ct">${esc(title)}</div>` : ""}<svg viewBox="0 0 ${W} ${H}" width="100%">
    ${bars.map((v, i) => `<rect x="${P + bw * i + 4}" y="${y(v)}" width="${bw - 8}" height="${H - 22 - y(v)}" rx="3" fill="${i === bars.length - 1 ? "#f2b84b" : "#2b343e"}"/>`).join("")}
    <polyline points="${pts}" fill="none" stroke="#8fc0ff" stroke-width="2"/>
    ${line.map((v, i) => `<circle cx="${P + bw * i + bw / 2}" cy="${ly(v)}" r="2.5" fill="#8fc0ff"/>`).join("")}
    ${line.map((v, i) => (i === line.length - 1 || i === 0 ? `<text x="${P + bw * i + bw / 2}" y="${ly(v) - 7}" font-size="10" fill="#8fc0ff" text-anchor="middle">${v.toFixed(0)}%</text>` : "")).join("")}
    ${labels.map((l, i) => `<text x="${P + bw * i + bw / 2}" y="${H - 6}" font-size="9" fill="#7d8893" text-anchor="middle">${esc(l.replace(/^(\w{3}) 20(\d\d)$/, "$1'$2"))}</text>`).join("")}
    <text x="${P + bw * (bars.length - 1) + bw / 2}" y="${y(bars.at(-1)) - 4}" font-size="10" fill="#f2b84b" text-anchor="middle">${inr(bars.at(-1))}</text></svg></div>`;
}
function pairBars(labels, a, b, la, lb) {
  const W = 360, H = 160, P = 24, vals = [...a, ...b], max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const z = (v) => 12 + ((max - v) / (max - min || 1)) * (H - 36);
  const bw = (W - P * 2) / labels.length;
  return `<div class="chart"><div class="ct"><span style="color:#7fd6a8">■ ${la}</span><span style="color:#8a949e">■ ${lb}</span></div><svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${P}" x2="${W - P}" y1="${z(0)}" y2="${z(0)}" stroke="#2d3640"/>
    ${labels.map((l, i) => { const x = P + bw * i; const ya = z(a[i]), yb = z(b[i]), y0 = z(0);
      return `<rect x="${x + 4}" y="${Math.min(ya, y0)}" width="${bw / 2 - 5}" height="${Math.abs(y0 - ya)}" rx="2" fill="${a[i] < 0 ? "#ef6b5f" : "#45c08a"}"/>
      <rect x="${x + bw / 2 + 1}" y="${Math.min(yb, y0)}" width="${bw / 2 - 5}" height="${Math.abs(y0 - yb)}" rx="2" fill="#4a5560"/>
      <text x="${x + bw / 2}" y="${H - 6}" font-size="9.5" fill="#7d8893" text-anchor="middle">${esc(l)}</text>`; }).join("")}</svg></div>`;
}

// ------------------------------------------------------------------ NETWORK
function renderNetwork() {
  const el = $("#v-network");
  const recent = D.people.filter((p) => D.filings.some((f) => f.people.includes(p.id) && inWindowDays(f.ts, 14)) && p.career.length > 1);
  const nudges = E.reconnect(D.net, D.filings, D.snap.asof);
  const themes = E.expertiseMap(D.net);
  el.innerHTML = `<h1 class="hero">Your network, <em>pointed at this week.</em></h1>
    <div class="privacy">🔒 <span><b>${D.net.contacts.length} contacts stay on this device.</b> Matching runs in the browser; the server only ever sees public filings. (Demo contacts are synthetic.)</span></div>
    ${egoGraph()}
    <div class="sec"><h2>People in this week's filings</h2><span class="c">your shortest way in</span></div>
    ${recent.map((p) => { const best = E.pathsToPerson(D.net, p, D.snap.asof).find((x) => x.degree > 0);
      return `<button class="card" data-act="person" data-arg="${p.id}" style="width:100%;text-align:left"><div class="hd"><span class="co">${esc(p.name)}</span><span class="tk">${p.company}</span></div>
        <div class="small" style="margin-bottom:8px">${esc(p.event)}</div>
        ${best ? `${pathHtml({ ...best, person: p })}<div class="link-why"><span class="kind">${best.degree === 1 ? "1st" : "2nd"} · ${esc(best.link.kind)}</span></div>` : `<div class="small">No overlap yet</div>`}</button>`; }).join("")}
    <div class="sec"><h2>Reasons to reconnect</h2><span class="c">${nudges.length}</span></div>
    ${nudges.slice(0, 5).map((x) => `<button class="person-row" data-act="contact" data-arg="${x.c.id}" style="width:100%;text-align:left">${av(x.c.name, x.c.id, 34)}
      <div><div class="nm">${esc(x.c.name)} <span class="small">· ${x.idle}d</span></div><div class="hl">${esc(D.names[x.f.sym] || x.f.sym)}: ${esc(x.f.title.slice(0, 70))}</div></div></button>`).join("")}
    <div class="sec"><h2>Expertise map</h2><span class="c">your go-to people by theme</span></div>
    ${themes.map((t) => `<button class="theme card" data-act="theme" data-arg="${esc(t.theme)}" style="width:100%;text-align:left"><div class="tn">${esc(t.theme)}<span>${t.people.length}</span></div>
      <div class="avs">${t.people.slice(0, 4).map((x) => `<span class="pc">${av(x.c.name, x.c.id, 22)}${esc(x.c.name.split(" ")[0])}</span>`).join("")}</div></button>`).join("")}
    <div class="sec"><h2>All contacts</h2><span class="c">${D.net.contacts.length}</span></div>
    ${D.net.contacts.slice().sort((a, b) => b.strength - a.strength).map((c) => `<button class="person-row" data-act="contact" data-arg="${c.id}" style="width:100%;text-align:left">${av(c.name, c.id, 30)}<div><div class="nm">${esc(c.name)}</div><div class="hl">${esc(c.headline)}</div></div></button>`).join("")}`;
}
const inWindowDays = (ts, d) => (new Date(D.snap.asof) - new Date(ts.length <= 10 ? ts + "T15:30:00+05:30" : ts + "+05:30")) / 864e5 <= d;

function egoGraph() {
  const W = 380, H = 300, cx = W / 2, cy = H / 2;
  const cs = D.net.contacts;
  const pos = {};
  cs.forEach((c, i) => { const a = (i / cs.length) * Math.PI * 2 - Math.PI / 2; const r = 135 - c.strength * 17; pos[c.id] = [cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 0.82]; });
  const hot = new Set(E.reconnect(D.net, D.filings, D.snap.asof).slice(0, 4).map((x) => x.c.id));
  const linked = new Set(D.people.flatMap((p) => E.pathsToPerson(D.net, p, D.snap.asof).filter((x) => x.degree === 1 && x.score > 0.3).map((x) => x.via.id)));
  const edges = cs.flatMap((c) => (c.knows || []).map(([b]) => pos[b] ? `<line x1="${pos[c.id][0]}" y1="${pos[c.id][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" stroke="#2a313a" stroke-width="1"/>` : ""));
  const spokes = cs.map((c) => `<line x1="${cx}" y1="${cy}" x2="${pos[c.id][0]}" y2="${pos[c.id][1]}" stroke="${linked.has(c.id) ? "#6c5fc7" : "#1c2229"}" stroke-width="${linked.has(c.id) ? 1.4 : 0.8}"/>`);
  const nodes = cs.map((c) => { const [x, y] = pos[c.id]; return `<g data-act="contact" data-arg="${c.id}" style="cursor:pointer">
    ${hot.has(c.id) ? `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#f2b84b" stroke-dasharray="2 3"/>` : ""}
    <circle cx="${x}" cy="${y}" r="${6 + c.strength * 1.6}" fill="${colorOf(c.id)}" opacity="${0.55 + c.strength * 0.09}"/>
    <text x="${x}" y="${y + 3}" font-size="7.5" font-weight="700" text-anchor="middle" fill="#0a0c0f">${esc(initials(c.name))}</text></g>`; });
  return `<div class="graph"><svg viewBox="0 0 ${W} ${H}" width="100%">${spokes.join("")}${edges.join("")}
    <circle cx="${cx}" cy="${cy}" r="17" fill="#e9edf1"/><text x="${cx}" y="${cy + 4}" font-size="10" font-weight="800" text-anchor="middle" fill="#0a0c0f">You</text>${nodes.join("")}</svg>
    <div class="legend">closer = stronger tie · <span style="color:#a99bff">violet</span> = links to someone in this week's filings · <span class="acc">dashed</span> = reconnect</div></div>`;
}

// ------------------------------------------------------------------ sheets
function openSheet(html) { $("#sheetBody").innerHTML = html; $("#sheet").classList.add("on"); $("#scrim").classList.add("on"); $("#sheetBody").scrollTop = 0; }
function closeSheet() { $("#sheet").classList.remove("on"); $("#scrim").classList.remove("on"); if (S.rec) try { S.rec.stop(); } catch {} }

function openPerson(id) {
  const p = D.peopleById[id];
  const paths = E.pathsToPerson(D.net, p, D.snap.asof).slice(0, 5);
  const fl = D.filings.filter((f) => f.people.includes(id));
  openSheet(`<h3>${esc(p.name)}</h3><div class="small">${esc(p.event)}</div>
    <p class="why">${esc(p.bio)}</p>
    <div class="sec"><h2>Career</h2><span class="c">public profile + filing annexure</span></div>
    <div class="tl">${p.career.map((c) => `<div><b>${esc(c.title)}</b><small>${esc(c.org)} · ${c.from ?? "?"}–${c.to ?? (c.from ? "now" : "?")}${c.approx ? " (approx.)" : ""}</small></div>`).join("")}</div>
    <div class="sec"><h2>Your way in</h2></div>
    ${paths.length ? paths.map((x) => `<div class="card">${x.degree === 0 ? `<b>You</b> <span class="kind">${esc(x.link.kind)}</span>` : pathHtml({ ...x, person: p })}<div class="link-why">${x.degree ? `<span class="kind">${x.degree === 1 ? "1st" : "2nd"} · ${esc(x.link.kind)}</span> ` : ""}${esc(x.link.why)}</div>
      ${x.via ? `<div class="acts"><button class="btn" data-act="contact" data-arg="${x.via.id}">Open ${esc(x.via.name.split(" ")[0])}</button></div>` : ""}</div>`).join("") : `<div class="empty">No overlap in your network yet. Add contacts who worked at ${esc(p.career.map((c) => c.org).slice(0, 3).join(", "))}.</div>`}
    ${p.ask?.length ? `<div class="sec"><h2>Worth asking</h2></div><div class="card"><ul style="margin:0;padding-left:18px">${p.ask.map((q) => `<li style="margin:5px 0">${esc(q)}</li>`).join("")}</ul></div>` : ""}
    ${fl.length ? `<div class="sec"><h2>In filings</h2></div>${fl.map((f) => `<div class="line"><span class="tkb">${f.sym}</span><a class="t" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.title)} ↗</a></div>`).join("")}` : ""}
    <p class="srcnote">Sources: ${p.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname)}</a>`).join(" · ") || "exchange filing"}</p>`);
}

function draftFor(c, reason) {
  const first = c.name.replace(/^Prof\.\s*/, "").split(" ")[0];
  return reason
    ? `Hi ${first}, hope you're well! ${reason} I'd value 20 minutes of your perspective. Coffee or a call next week?`
    : `Hi ${first}, it's been a while. Would love to catch up over coffee in the next couple of weeks.`;
}

function openContact(id) {
  const c = D.net.byId[id];
  const idle = daysAgo(c.last);
  const nudge = E.reconnect(D.net, D.filings, D.snap.asof, 0).find((x) => x.c.id === id);
  const links = D.people.map((p) => ({ p, l: E.directLink(D.net, c, p) })).filter((x) => x.l && x.l.w >= 0.3);
  const reason = nudge ? `Saw ${D.names[nudge.f.sym] || nudge.f.sym}'s filing (“${nudge.f.title.slice(0, 70)}”), and given your time at ${nudge.e.org} I'd love your read.` : "";
  const knows = (c.knows || []).map(([b]) => D.net.byId[b]).filter(Boolean);
  openSheet(`<div style="display:flex;gap:12px;align-items:center">${av(c.name, c.id, 46)}<div><h3>${esc(c.name)}</h3><div class="small">${esc(c.headline)} · ${esc(c.city)}</div></div></div>
    <div class="kv" style="margin-top:12px"><div><div class="k">Tie strength</div><div class="v">${"●".repeat(c.strength)}<span class="mu">${"●".repeat(5 - c.strength)}</span></div></div>
    <div><div class="k">Last spoke</div><div class="v ${idle > 180 ? "acc" : ""}">${idle} days ago</div></div><div style="grid-column:1/-1"><div class="k">How you met</div><div class="v" style="font-size:14px">${esc(c.met)}</div></div></div>
    ${nudge ? `<div class="sec"><h2>Why now</h2></div><div class="card"><div class="why" style="margin:0">${esc(D.names[nudge.f.sym])}: ${esc(nudge.f.title)}</div><div class="small" style="margin-top:4px">${esc(nudge.f.why || "")}</div></div>` : ""}
    ${links.length ? `<div class="sec"><h2>Connects you to</h2></div>${links.map((x) => `<button class="card" data-act="person" data-arg="${x.p.id}" style="width:100%;text-align:left"><b>${esc(x.p.name)}</b> <span class="kind">${esc(x.l.kind)}</span><div class="link-why">${esc(x.l.why)}</div></button>`).join("")}` : ""}
    <div class="sec"><h2>Career</h2></div><div class="tl">${c.career.map((e) => `<div><b>${esc(e.title)}</b><small>${esc(e.org)} · ${e.from}–${e.to ?? "now"}</small></div>`).join("")}${c.education.map((e) => `<div><b>${esc(e.degree)}</b><small>${esc(e.school)} · ${e.year}</small></div>`).join("")}</div>
    <div class="sec"><h2>Knows about</h2></div><div class="tog">${c.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    ${knows.length ? `<div class="sec"><h2>Can introduce you to</h2></div><div class="avs">${knows.map((k) => `<button class="pc" data-act="contact" data-arg="${k.id}">${av(k.name, k.id, 22)}${esc(k.name)}</button>`).join("")}</div>` : ""}
    <div class="sec"><h2>Draft a note</h2></div><div class="draft">${esc(draftFor(c, reason))}</div>
    <div class="acts"><button class="btn pri" data-act="copy">Copy draft</button></div>
    <p class="srcnote">Synthetic demo contact. In production this profile is built from the investor's own import (contacts / LinkedIn export) and stays on-device.</p>`);
}

function openCalls(sym) {
  openSheet(`<h3>Who can explain ${esc(D.names[sym] || sym)}?</h3><p class="small">Ranked by relevance × tie strength × recency. Insiders are flagged.</p>${callBlock(sym, 6).replace('<div class="netbox">', '<div>')}`);
}
function openTheme(theme) {
  const t = E.expertiseMap(D.net).find((x) => x.theme === theme);
  openSheet(`<h3>${esc(theme)}</h3><p class="small">Your go-to people, ranked by depth × tie strength</p>
    ${t.people.map((x) => `<button class="person-row" data-act="contact" data-arg="${x.c.id}" style="width:100%;text-align:left">${av(x.c.name, x.c.id, 32)}<div><div class="nm">${esc(x.c.name)}</div><div class="hl">${esc(x.c.headline)} · ${esc(x.c.tags.join(", "))}</div></div></button>`).join("")}`);
}

function openAlerts() {
  const cats = ["results", "M&A", "management_change", "litigation", "fund_raise", "capex", "credit_rating", "pledging", "insider_trading", "dividend", "earnings_call"];
  openSheet(`<h3>What counts as unusual?</h3><p class="small">You decide; FINN watches. These settings apply to EOD data and decide which filings get a full card.</p>
    <div class="form"><div class="row"><label><span>Daily price move</span><b id="pv">±${S.cfg.pricePct}%</b></label><input id="pp" type="range" min="1" max="15" step="0.5" value="${S.cfg.pricePct}"></div>
    <div class="row"><label><span>Volume vs 10-day average</span><b id="vv">${S.cfg.volX}×</b></label><input id="vx" type="range" min="1.5" max="10" step="0.5" value="${S.cfg.volX}"></div>
    <div class="row"><label><span>Announcement types that get a full card</span></label><div class="tog">${cats.map((c) => `<button class="chip ${S.cfg.watch.includes(c) ? "on" : ""}" data-cat="${c}">${CAT[c]}</button>`).join("")}</div></div>
    <div id="prev" class="small"></div>
    <div class="acts"><button class="btn pri" id="saveCfg">Save</button><button class="btn" id="resetCfg">Reset</button></div></div>`);
  const prev = () => { const n = E.priceAlerts(D.prices, D.snap.dates, S.cfg, D.filings).filter((a) => inWindowDays(a.date, 14)).length; $("#prev").textContent = `With these settings: ${n} price/volume alerts in the last 14 days.`; };
  $("#pp").oninput = (e) => { S.cfg.pricePct = +e.target.value; $("#pv").textContent = `±${S.cfg.pricePct}%`; prev(); };
  $("#vx").oninput = (e) => { S.cfg.volX = +e.target.value; $("#vv").textContent = `${S.cfg.volX}×`; prev(); };
  document.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { const c = b.dataset.cat; S.cfg.watch = S.cfg.watch.includes(c) ? S.cfg.watch.filter((x) => x !== c) : [...S.cfg.watch, c]; b.classList.toggle("on"); }));
  $("#saveCfg").onclick = () => { store.set("cfg", S.cfg); closeSheet(); toast("Alert rules saved"); if (S.view === "today") renderToday(); };
  $("#resetCfg").onclick = () => { S.cfg = { ...DEF_CFG }; store.set("cfg", S.cfg); openAlerts(); };
  prev();
}

// ------------------------------------------------------------------ ASK (one box for push, pull and network)
function openAsk(q = "") {
  const sugg = ["Who knows Raghu Panicker?", "Who should I call on Sun Pharma?", "What did PI promise vs deliver?", "Experts in semiconductors", "Who should I reconnect with?", "Analyse NAVINFLUOR"];
  openSheet(`<h3>Ask FINN</h3><div class="ask-in"><input id="q" placeholder="A person, a company, a theme…" value="${esc(q)}" autocomplete="off"><button class="mic" id="mic" title="Speak">🎙</button></div>
    <div class="sugg">${sugg.map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div><div id="ans"></div>`);
  const i = $("#q");
  setTimeout(() => i.focus(), 250);
  i.onkeydown = (e) => { if (e.key === "Enter") answer(i.value); };
  document.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { i.value = b.dataset.s; answer(b.dataset.s); }));
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#mic");
  if (!SR) mic.style.display = "none";
  else mic.onclick = () => {
    const r = new SR(); S.rec = r; r.lang = "en-IN"; r.interimResults = true; mic.classList.add("rec");
    r.onresult = (e) => { i.value = [...e.results].map((x) => x[0].transcript).join(""); if (e.results[e.results.length - 1].isFinal) answer(i.value); };
    r.onend = () => mic.classList.remove("rec"); r.start();
  };
  if (q) answer(q);
}

function findCompany(q) {
  const t = q.toLowerCase();
  for (const p of D.snap.portfolio) if (t.includes(p.sym.toLowerCase()) || t.includes(p.name.toLowerCase()) || t.includes(p.name.split(" ")[0].toLowerCase())) return p.sym;
  const m = q.match(/\b([A-Z][A-Z0-9&-]{2,14})\b/);
  return m ? m[1] : null;
}

function answer(q) {
  const out = $("#ans"), t = q.toLowerCase().trim();
  if (!t) return;
  const box = (h, body) => (out.innerHTML = `<div class="answer"><div class="ah">${esc(h)}</div>${body}</div>`);
  const person = D.people.find((p) => t.includes(p.name.toLowerCase().replace(/\./g, "").split(" ").slice(-1)[0]) || t.includes(p.name.toLowerCase()));
  const contact = D.net.contacts.find((c) => t.includes(c.name.toLowerCase()));
  if (/reconnect|catch up|haven.t (spoken|talked)|lost touch/.test(t)) {
    const r = E.reconnect(D.net, D.filings, D.snap.asof).slice(0, 5);
    return box("Natural reasons to reconnect", r.map((x) => `<button class="person-row" data-act="contact" data-arg="${x.c.id}" style="width:100%;text-align:left">${av(x.c.name, x.c.id, 30)}<div><div class="nm">${esc(x.c.name)} · ${x.idle}d</div><div class="hl">${esc(D.names[x.f.sym])}: ${esc(x.f.title.slice(0, 60))}</div></div></button>`).join(""));
  }
  if (person && /who|know|introduc|connect|reach|way in|path|meet/.test(t) || person && t.split(" ").length <= 3) {
    const paths = E.pathsToPerson(D.net, person, D.snap.asof).filter((x) => x.degree > 0).slice(0, 3);
    return box(`Your way in to ${person.name}`, (paths.map((x) => `<div style="margin:8px 0">${pathHtml({ ...x, person })}<div class="link-why"><span class="kind">${x.degree === 1 ? "1st" : "2nd"} · ${esc(x.link.kind)}</span> ${esc(x.link.why)}</div></div>`).join("") || "No overlap found.") + `<div class="acts"><button class="btn" data-act="person" data-arg="${person.id}">Full profile</button></div>`);
  }
  if (contact) return openContact(contact.id);
  const themes = E.expertiseMap(D.net);
  const th = themes.find((x) => t.includes(x.theme.toLowerCase().split(/[ &(]/)[0]) || D.net.themes[x.theme].some((tag) => t.includes(tag.toLowerCase())));
  if (/expert|go-to|who knows about|specialist/.test(t) && th) return openTheme(th.theme);
  const sym = findCompany(q);
  if (sym && /promise|deliver|guidance|guided|narrative/.test(t)) { S.sym = sym; S.seg = "promises"; closeSheet(); return go("research"); }
  if (sym && /call|talk|explain|ask|who/.test(t)) {
    return box(`Who can explain ${D.names[sym] || sym}`, callBlock(sym, 4).replace('<div class="netbox">', "<div>") || "No one in your network maps to this company yet.");
  }
  if (sym && /analy|research|deep|look|open|pull|fundamental|^[a-z0-9&-]+$/.test(t)) { S.sym = sym; S.seg = "overview"; closeSheet(); return go("research"); }
  if (/today|changed|brief|digest|what.s new|happened/.test(t)) { closeSheet(); return go("today"); }
  if (/alert|threshold|notify/.test(t)) return openAlerts();
  if (th) return openTheme(th.theme);
  box("Not sure yet", `Try a person (“Leo Puri”), a company (“Kaynes”), a ticker to analyse, or a theme (“specialty chemicals”).`);
}

boot().catch((e) => { document.getElementById("main").innerHTML = `<div class="err" style="margin:20px">Failed to load data: ${esc(e.message)}</div>`; console.error(e); });

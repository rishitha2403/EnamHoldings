// Offline tests: parser on a screener-shaped fixture, quote verification, prefilter, and the analysis engine on the parsed output.
const fs = require("fs"), assert = require("assert");
const { parse } = require("../lib/screener");
const { verifyQuote, prefilter, numbersTable } = require("../lib/guidance");
const F = parse(fs.readFileSync(__dirname + "/fixture_screener.html", "utf8"), "NAVINFLUOR");
assert.equal(F.name, "Navin Fluorine International Ltd");
assert.equal(F.mcap_cr, 27410); assert.equal(F.price, 5520); assert.equal(F.hi52, 5900); assert.equal(F.lo52, 3200);
assert.deepEqual(F.q.sales, [758, 800, 850, 870, 910]); assert.deepEqual(F.q.opm, [25, 25, 25, 25, 26]); assert.equal(F.q.pat.at(-1), 140);
assert.deepEqual(F.y_labels, ["FY21", "FY22", "FY23", "FY24", "FY25", "FY26", "TTM"]);
assert.deepEqual(F.bs.equity, [2010, 2210, 2410, 2810]);
assert.deepEqual(F.cf.cfo, [300, 420, 610]); assert.equal(F.wc.wc_days.at(-1), 105);
assert.equal(F.docs.concalls.length, 2); assert.equal(F.docs.concalls[0].url, "https://www.bseindia.com/x/t1.pdf"); assert.equal(F.docs.concalls[0].date, "Nov 2026");
assert.equal(F.docs.annual_reports[0].year, "FY 2026");
const T = "Mr. X: We expect FY27 revenue growth of 20% to 25% driven by CDMO. Thank you.";
assert(verifyQuote("We expect FY27 revenue growth of 20% to 25%", T));
assert(!verifyQuote("We expect FY27 revenue growth of 40%", T));
assert(prefilter("Hello and welcome to the call everyone, thank you for joining us today.\n\nWe expect margins to improve going forward as utilisation rises in FY27.").kept === 1);
assert(numbersTable(F).includes("Sep 2026: sales 910"));
// structural fallback: same page with ids/classes stripped, headings kept
let bare = fs.readFileSync(__dirname + "/fixture_screener.html", "utf8")
  .replace(/ id="[^"]*"/g, "").replace(/ class="[^"]*"/g, "")
  .replace("<section><table class", "<section><h2>Quarterly Results</h2><table class");
bare = bare.replace(/<section>(<table>)/, "<section><h2>Quarterly Results</h2>$1");
const B = parse(bare, "NAVINFLUOR");
assert.equal(B.mcap_cr, 27410, "ratio fallback"); assert.deepEqual(B.q.sales, [758, 800, 850, 870, 910], "quarters fallback");
assert.equal(B.docs.concalls[0].url, "https://www.bseindia.com/x/t1.pdf", "transcript fallback"); assert.equal(B.docs.concalls[0].date, "Nov 2026");
import("../public/js/engine.js").then((E) => {
  const A = E.analyse(F);
  assert(A.snapshot.length >= 6 && A.trajectory.length >= 3 && A.cash.length >= 3);
  console.log("all tests passed ·", A.flags.green.length, "green /", A.flags.red.length, "red flags on fixture");
});

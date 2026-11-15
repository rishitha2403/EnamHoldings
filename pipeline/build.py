"""Build the app's data bundle from raw pipeline outputs.

    python pipeline/build.py            # raw/ -> public/data/*.json

raw/ is filled by fetch_nse.py (announcements), fetch_screener.py (EOD price/volume,
fundamentals) and the curated/LLM-extracted guidance + people files. This step is
pure, deterministic and offline: classification rules, priority, entity linking.
"""
import json, glob, os, re, sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import classify, extract_people  # noqa: E402

PORTFOLIO = [
    ("RELIANCE", "Reliance Industries", "Energy & Telecom", "Large"),
    ("TCS", "Tata Consultancy Services", "IT Services", "Large"),
    ("HDFCBANK", "HDFC Bank", "Banks", "Large"),
    ("ICICIBANK", "ICICI Bank", "Banks", "Large"),
    ("BAJFINANCE", "Bajaj Finance", "NBFC", "Large"),
    ("LT", "Larsen & Toubro", "Capital Goods", "Large"),
    ("ASIANPAINT", "Asian Paints", "Paints", "Large"),
    ("TITAN", "Titan Company", "Jewellery & Lifestyle", "Large"),
    ("SUNPHARMA", "Sun Pharmaceutical", "Pharma", "Large"),
    ("TRENT", "Trent", "Retail", "Large"),
    ("INDIGO", "InterGlobe Aviation", "Aviation", "Large"),
    ("DIXON", "Dixon Technologies", "EMS", "Mid"),
    ("POLYCAB", "Polycab India", "Cables & Wires", "Mid"),
    ("CDSL", "CDSL", "Market Infra", "Mid"),
    ("DEEPAKNTR", "Deepak Nitrite", "Chemicals", "Mid"),
    ("PIIND", "PI Industries", "Agrochemicals", "Mid"),
    ("KAYNES", "Kaynes Technology", "EMS & Semis", "Small"),
    ("CLEAN", "Clean Science & Technology", "Specialty Chemicals", "Small"),
]
DATES = ["2026-10-16", "2026-10-19", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28",
         "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-08",
         "2026-11-09", "2026-11-11", "2026-11-12", "2026-11-13"]

# One-line "why it matters" written by the summariser step (LLM in production;
# here the curated output of that step is checked in so the demo is reproducible).
WHY = {
    "KAYNESTECH_14112026234020": "Results arrived just before midnight on the statutory deadline, and the auditor's review flags restated prior-period errors plus an associate it could not review. Read this before the 08:30 call on Monday.",
    "KAYNESTECH_15112026001518": "A second JV in four days (display modules with Toyokawa), plus a subsidiary strike-off. The group structure is getting more complex quickly.",
    "KAYNESTECH_12112026192018": "Vishay takes 49% of the OSAT subsidiary. That brings an anchor partner, but shareholders now own about half of the most valuable option.",
    "PIIND_04112026193824": "Q2 PAT −70% YoY and EBITDA margin halved to 14%. The stock fell 19% the next day on 25× normal volume.",
    "TITAN_05112026165028": "Strong headline PAT +114% YoY, but about ₹490 cr is a customs-duty gain and ₹671 cr a fair-value change on the Damas liability. Normalised jewellery margin is 11.1%.",
    "HDFCBANK3_06112026152141": "The new Chief Compliance Officer from ICICI Bank started about two months earlier than announced.",
    "ASIANPAINT_06112026220521": "Leo Puri is now on the board and becomes Chairman on 23 Jan 2027. A financial-services chairman during a paint price war is a signal worth reading.",
    "SUNSEC_04112026100317": "Regulator-ordered halt of eye-care production at one plant after quality lapses. Watch for a USFDA read-through.",
    "BAJFINANCE_11112026171309": "QIP opened at a ₹992 floor, alongside ₹5,800 cr of promoter warrants at ₹1,010. That totals about ₹17,500 cr of fresh equity, roughly 3% dilution.",
    "BAJFINANCE_10112026125828": "Promoter Bajaj Finserv paid 25% upfront on warrants at ₹1,010, above the QIP floor: a vote of confidence at a premium.",
    "PAM_09112026103717": "A 'significant' (₹1,000–2,500 cr) metro order. It adds to the order book but is not thesis-changing for L&T.",
    "TITAN_05112026185140": "Noel Tata leaves the board, so Tata Trusts' direct presence on Titan's board changes.",
    "TITAN_11112026143915": "Transcript: the festive season was strong at the start and end but soft in between on gold volatility; studded demand was strong. Feeds Titan's research page.",
    "PIIND_12112026103314": "Transcript: AgChem exports −18%, domestic +19%, first NCE (Pioxazon) launched. Feeds the promised-vs-delivered tracker.",
    "TITAN_05112026183630": "Statutory auditor rotation. This is routine unless the outgoing auditor flagged something.",
    "HDFCBANK3_13112026163422": "V. S. Rangan re-appointed for only one year, against three years last time. Ask about succession.",
    "BAJFINANCE_07112026162848": "H1 FY27 PAT +28%, AUM +26%, GNPA 1.06%. Growth is intact going into the raise.",
}


def ts_ok(s):
    return datetime.fromisoformat(s)


def key_of(url):
    m = re.search(r"/corporate/([A-Za-z0-9]+_\d{14})", url)
    return m.group(1) if m else url


def main():
    os.makedirs(OUT, exist_ok=True)
    names = {s: n for s, n, _, _ in PORTFOLIO}
    people = json.load(open(os.path.join(RAW, "people.json")))["people"]
    by_name = {}
    for p in people:
        for tok in {p["name"], p["name"].replace(".", "").replace("  ", " ")}:
            by_name[tok.lower()] = p["id"]

    # ---- filings ---------------------------------------------------------
    rows = []
    for f in sorted(glob.glob(os.path.join(RAW, "ann_part*.jsonl"))):
        for line in open(f):
            if line.strip():
                rows.append(json.loads(line))
    filings, llm_needed = [], 0
    for r in rows:
        c = classify(r)
        if c["category"] == "unclassified" and c["priority"] > 8:
            llm_needed += 1
        k = key_of(r["url"])
        ppl = []
        for nm in extract_people(r):
            for cand, pid in by_name.items():
                if nm.lower().replace(".", "") in cand.replace(".", "") or cand.replace(".", "").endswith(nm.lower().replace(".", "")):
                    ppl.append(pid)
        # Filings whose person names sit only in the PDF annexure are linked by the
        # pipeline's PDF step; mirror that here for the demo set.
        ppl += {"HDFCBANK3_06112026152141": ["vn-srivatsan"], "ASIANPAINT_06112026220521": ["leo-puri"],
                "ASIANPAINT_06112026220150": ["leo-puri"], "KAYNESTECH_12112026192018": ["raghu-panicker"],
                "TITAN_05112026185140": ["noel-tata"], "HDFCBANK3_13112026163422": ["v-srinivasa-rangan"],
                "HDFCBANK3_12112026173223": ["v-srinivasa-rangan"]}.get(k, [])
        filings.append({
            "id": k, "sym": r["sym"], "name": names.get(r["sym"], r["sym"]), "ts": r["ts"], "nse": r["nse"],
            "title": r["title"], "summary": r.get("summary", ""), "url": r["url"],
            "why": WHY.get(k, ""), "people": sorted(set(ppl)), **c})
    filings.sort(key=lambda x: x["ts"], reverse=True)
    # merge duplicates (same event filed twice under different desc) -> keep higher priority
    seen, dedup = {}, []
    for f in filings:
        sig = (f["sym"], f["ts"][:10], f["category"], tuple(f["people"])) if f["people"] else (f["sym"], f["title"][:40].lower())
        if sig in seen:
            continue
        seen[sig] = 1
        dedup.append(f)

    # ---- prices ----------------------------------------------------------
    px = {}
    for line in open(os.path.join(RAW, "px", "batch1.txt")):
        s, p, v = line.strip().split("|")
        px[s] = {"c": [float(x) for x in p.split(",")], "v": [int(x) for x in v.split(",")]}

    fundamentals = json.load(open(os.path.join(RAW, "fundamentals.json")))
    fundamentals["TITAN"] = {
        "name": "Titan Company Ltd", "asof": "2026-11-13", "price": 4845, "mcap_cr": 430124, "pe": 60.5, "book": 206, "roce": 20.5, "roe": 37.7, "hi52": 5187, "lo52": 3751, "div_yield": 0.31,
        "about": "Lifestyle company: jewellery (Tanishq, Mia, Zoya, CaratLane), watches & wearables, eyewear; Tata group with TIDCO as co-promoter.",
        "q_labels": ["Sep 2023", "Dec 2023", "Mar 2024", "Jun 2024", "Sep 2024", "Dec 2024", "Mar 2025", "Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"],
        "q": {"sales": [12529, 14164, 12494, 13266, 14534, 17740, 14916, 16523, 18725, 25416, 26920, 21356, 20614],
              "ebitda": [1411, 1565, 1191, 1247, 1236, 1674, 1537, 1830, 1875, 2713, 1938, 2890, 2983],
              "opm": [11, 11, 10, 9, 8, 9, 10, 11, 10, 11, 7, 14, 14],
              "other_inc": [125, 136, 159, 120, 123, 128, 116, 105, 113, -1, 235, 148, 816],
              "interest": [140, 169, 201, 230, 240, 231, 252, 271, 277, 282, 350, 353, 536],
              "dep": [144, 154, 158, 164, 171, 175, 183, 184, 189, 207, 246, 256, 263],
              "pbt": [1252, 1378, 991, 973, 948, 1396, 1218, 1480, 1522, 2223, 1577, 2429, 3000],
              "tax": [27, 24, 22, 27, 26, 25, 28, 26, 26, 24, 25, 27, 20],
              "pat": [916, 1053, 771, 715, 704, 1047, 871, 1091, 1120, 1684, 1179, 1777, 2393]},
        "y_labels": ["FY15", "FY16", "FY17", "FY18", "FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25", "FY26", "TTM"],
        "y": {"sales": [11913, 11276, 13261, 16120, 19779, 21052, 21644, 28799, 40575, 51084, 60456, 87584, 94306],
              "ebitda": [1153, 939, 1164, 1644, 1994, 2463, 1725, 3344, 4882, 5292, 5694, 8357, 10524],
              "opm": [10, 8, 9, 10, 10, 12, 8, 12, 12, 10, 9, 10, 11],
              "pbt": [1049, 868, 973, 1530, 1957, 2102, 1327, 2904, 4447, 4623, 4535, 6801, 9229],
              "pat": [816, 675, 697, 1102, 1389, 1493, 974, 2198, 3274, 3496, 3337, 5073, 7033]},
        "bs_labels": ["FY15", "FY16", "FY17", "FY18", "FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25", "FY26", "H1FY27"],
        "bs": {"equity": [3084, 3507, 4233, 5090, 6070, 6669, 7497, 9303, 11851, 9393, 11624, 15703, 18263],
               "borrowings": [100, 113, 1882, 1691, 2393, 3562, 5638, 7275, 9367, 15528, 20777, 30621, 27638],
               "fixed_assets": [699, 771, 1189, 1474, 1567, 2633, 2523, 2544, 2998, 3709, 4062, 6878, 7159],
               "cwip": [55, 107, 152, 43, 32, 18, 32, 85, 144, 97, 105, 163, 142],
               "investments": [3, 30, 431, 36, 108, 158, 2824, 294, 2515, 2345, 1988, 3506, 2672]},
        "notes": "Q2 FY27 other income ₹816 cr and PBT include one-offs: customs-duty gain (Titan Jewellery ₹490 cr, CaratLane ₹46 cr) and a ₹671 cr fair-value adjustment on the Damas acquisition liability (per Q2 transcript filing). Gold-metal-loan borrowings drive the debt line."}

    snapshot = {"asof": "2026-11-15T08:00:00+05:30", "eod": "2026-11-13", "dates": DATES,
                "portfolio": [{"sym": s, "name": n, "sector": sec, "size": sz} for s, n, sec, sz in PORTFOLIO],
                "research": ["PIIND", "KAYNES", "TITAN"]}

    json.dump(snapshot, open(os.path.join(OUT, "snapshot.json"), "w"), indent=1)
    json.dump(dedup, open(os.path.join(OUT, "filings.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(px, open(os.path.join(OUT, "prices.json"), "w"))
    json.dump(fundamentals, open(os.path.join(OUT, "fundamentals.json"), "w"), ensure_ascii=False)
    for name in ("guidance.json", "people.json", "network.json"):
        json.dump(json.load(open(os.path.join(RAW, name))), open(os.path.join(OUT, name), "w"), indent=1, ensure_ascii=False)

    cats = {}
    for f in dedup:
        cats[f["category"]] = cats.get(f["category"], 0) + 1
    print(f"filings: {len(rows)} raw -> {len(dedup)} after dedup; LLM fallback needed for {llm_needed}")
    print("categories:", dict(sorted(cats.items(), key=lambda x: -x[1])))
    print("treatment:", {t: sum(1 for f in dedup if f['treatment'] == t) for t in ('brief', 'line', 'fold')})


if __name__ == "__main__":
    main()

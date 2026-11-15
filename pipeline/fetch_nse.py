"""Fetch corporate announcements for the portfolio from NSE (primary source).

    python pipeline/fetch_nse.py --from 03-11-2026 --to 15-11-2026

NSE's API needs a browser-like session: hit the homepage once for cookies, then call
/api/corporate-announcements per symbol. Writes data/raw/ann_nse.jsonl in the same shape
build.py consumes. Run on a schedule (e.g. every 15 min in market hours) for Push.
"""
import argparse, json, os, time
import requests

SYMS = ["RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "BAJFINANCE", "LT", "ASIANPAINT", "TITAN", "SUNPHARMA", "TRENT",
        "INDIGO", "DIXON", "POLYCAB", "CDSL", "DEEPAKNTR", "PIIND", "KAYNES", "CLEAN"]
H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements"}
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "ann_nse.jsonl")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--from", dest="f", required=True); ap.add_argument("--to", dest="t", required=True)
    a = ap.parse_args()
    s = requests.Session(); s.headers.update(H); s.get("https://www.nseindia.com", timeout=15)
    n = 0
    with open(OUT, "w") as out:
        for sym in SYMS:
            r = s.get("https://www.nseindia.com/api/corporate-announcements", params={"index": "equities", "symbol": sym, "from_date": a.f, "to_date": a.t}, timeout=20)
            r.raise_for_status()
            for x in r.json():
                d = time.strptime(x["an_dt"], "%d-%b-%Y %H:%M:%S")
                out.write(json.dumps({"sym": sym, "ts": time.strftime("%Y-%m-%dT%H:%M:%S", d), "nse": x.get("desc", ""), "title": x.get("attchmntText", ""),
                                      "summary": x.get("voiceSummary") or "", "url": x.get("attchmntFile", "")}) + "\n"); n += 1
            time.sleep(0.4)  # be polite
    print(f"{n} announcements -> {OUT}")


if __name__ == "__main__":
    main()

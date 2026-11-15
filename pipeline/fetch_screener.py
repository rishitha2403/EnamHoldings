"""EOD price/volume (screener chart API, NSE prices) for the portfolio.

    python pipeline/fetch_screener.py           # writes data/raw/px/batch1.txt

yfinance (SYMBOL.NS) is an equivalent alternative; screener was used because it also
returns delivery % and is the same source as fundamentals. Fundamentals for any ticker
are fetched live by api/company.js (lib/screener.js), so no batch job is needed for them.
"""
import os, requests, time
IDS = {"RELIANCE": 2726, "TCS": 3365, "HDFCBANK": 1298, "ICICIBANK": 1384, "BAJFINANCE": 372, "LT": 1870, "ASIANPAINT": 295, "TITAN": 3437,
       "SUNPHARMA": 3245, "TRENT": 3467, "INDIGO": 1273121, "DIXON": 1274137, "POLYCAB": 1274653, "CDSL": 1274088, "DEEPAKNTR": 786,
       "PIIND": 2474, "KAYNES": 1275358, "CLEAN": 1274890}
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "px", "batch1.txt")

def main():
    rows = []
    for sym, cid in IDS.items():
        j = requests.get(f"https://www.screener.in/api/company/{cid}/chart/", params={"q": "Price-Volume", "days": 30}, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()
        p = {d["metric"]: d["values"] for d in j["datasets"]}
        rows.append(f"{sym}|{','.join(v[1] for v in p['Price'])}|{','.join(str(v[1]) for v in p['Volume'])}")
        time.sleep(0.5)
    open(OUT, "w").write("\n".join(rows) + "\n")
    print(f"{len(rows)} symbols -> {OUT}")

if __name__ == "__main__":
    main()

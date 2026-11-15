To: assessment@enam.com
Subject: IIT Kanpur – Founding AI Engineer - 2027

Dear ENAM team,

Please find my submission for the FINN build challenge.

**Links**
- Prototype (open on a phone): <VERCEL_URL>
- GitHub (public): <GITHUB_URL>
- AI build history: <CLAUDE_SHARE_LINK>

**How this was built (please read first).** In the interest of full transparency: this prototype was built in a single Claude session run by Aarav Oswal (IIT Kanpur, roll no. 230012), with Claude doing most of the data collection and code. That session is the build history linked above. My own part was: <RISHITHA: write 2–3 honest lines here, e.g. reviewing the design, testing on phone, deploying, editing the writeup>. I'd welcome the chance to walk through any part of it and to show my own building in a follow-up round.

**What we built**
FINN is a mobile-first PWA built around one idea: an investor's day should start with a short brief, not a feed. Every item answers three questions: what changed, why it matters, and who I know who can explain it.
- **Push:**
  - Uses 78 real NSE filings (3–15 Nov) across an 18-stock portfolio. Rules rank them so 12 earn a full card (grouped into 9 stories), 14 become one-liners and 51 routine filings are folded away.
  - The window can be 24h, 3d, 7d, 14d or any start date.
  - EOD price and volume alerts use thresholds the user sets (default ±5% / 2× the 10-day average volume). Each move is linked to the filing that explains it: PI Industries fell 19% on 23× volume the day after a −70% PAT quarter. Moves with no explanation are flagged, such as a 28× volume spike in Deepak Nitrite.
- **The three card types from the brief:**
  - **Management change:** the incoming person's bio (filing annexure plus public profile) and the user's path in. HDFC Bank's new Chief Compliance Officer is reached through an ex-ICICI contact on the same compliance team.
  - **Results:** Revenue, EBITDA, PBT and PAT QoQ and YoY, with one-offs flagged. Titan's +114% PAT includes a ₹490 cr customs-duty gain.
  - **Material event:** the best person to call and why; for the Sun Pharma plant halt it is an ex-Sun QA head. Kaynes filed results at 23:42 on the deadline, so its card leads with the auditor's restatement flag instead of inventing numbers.
- **Pull:**
  - Works for any NSE ticker via a live screener.in fetch.
  - The core view is promised vs delivered: management's own transcript quotes, tracked across calls and checked against reported numbers. PI Industries walked FY27 growth guidance down twice while H1 came in at −10%; the tracker scores 4 kept, 4 missed, 1 mixed and 2 open. Kaynes promised to turn cash-positive in FY27 after −₹600 cr operating cash flow in FY26.
  - Bull and bear points are computed from the numbers by code, never by a model. Pull uses primary sources only.
- **Network:**
  - Shows up inside every card, and in a typed or spoken Ask box.
  - Covers who to call (alumni, peers, customers, JV partners), with current insiders flagged for unpublished-information risk.
  - Finds two-hop paths with honest confidence labels, runs diligence on people, and builds an expertise map.
  - Suggests natural reasons to reconnect: a dormant contact whose former employer just filed something material.

**Key decisions and tradeoffs**
1. **Rules before models.** Classification and priority are deterministic, mapped to your reference categories. All 78 filings were placed with zero tokens.
2. **Numbers by code, words by model.** Every number on screen is computed.
3. **No hallucinated quotes.** For live guidance, a cheap model extracts claims from keyword-prefiltered transcripts (about 85% fewer tokens). Every quote is verified against the PDF text in code before a stronger model judges it against a numbers table.
4. **The network is private by architecture.** The graph and all matching run on-device. The server sees only public filings, and contacts are never sent to an LLM.
5. **Frozen snapshot over live polling** for the demo, so it works for every reviewer. The fetchers are in the repo.

**Architecture** (diagram in the README)
- **Data pipelines:**
  - NSE announcements API, then a rules classifier, then entity resolution (names in filings matched to a public people registry, then to the private network by employer, tenure and school overlap).
  - screener.in for EOD prices and fundamentals of any ticker.
  - Transcript PDFs go through prefilter, extract, verify and judge.
- **Security and privacy:**
  - The contacts graph is designed to sit encrypted in on-device storage behind a passkey, with optional end-to-end-encrypted sync.
  - Contacts come from the user's own import, with consent and per-contact delete. There is no scraping.
  - Public-person profiles expire after 90 days and carry source links.
- **Network data:** the 32 contacts in the demo are synthetic (real employers, fictional people). In production the investor would import their own contacts or LinkedIn data export.
- **LLMs:** Gemini Flash-Lite for bulk extraction and Gemini Flash for verdicts, with rules and code everywhere else. It's a fixed pipeline rather than a free-roaming agent: cheaper, testable and reproducible. A live company costs about 20k tokens (free tier) and is CDN-cached.
- **Cloud:** Vercel (static PWA plus serverless functions). In production, a cron worker and KV store would be added; there is no user state on the server.

**Deliberately left out:** live polling in the demo, parsing results PDFs for the newest quarter, real LinkedIn data, auth and push notifications.

**Next:** an XBRL results parser, web-push alerts, a contacts import wizard, pre-meeting briefs combining all three layers, and sector KPI trackers.

Thank you,
Ch Rishitha
IIT Kanpur · Roll no. 230311

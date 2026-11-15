"""Rules-first announcement classifier.

Every filing goes through cheap deterministic rules first. Only filings that the
rules cannot place with confidence (category == "unclassified" AND not obviously
routine) are sent to a small LLM (see llm.py: classify_with_llm). In the demo
snapshot the rules placed 76 of 78 filings, so the LLM handled about 3% of volume.

Categories follow the ENAM reference document. Priority is 0-100 and decides how
FINN presents the item:
  >= 70  "brief"   full card with enrichment (results table / bio + network / who to call)
  35-69  "line"    one-line summary next to the filing
  < 35   "fold"    collapsed into "N routine filings"
"""
import re

RULES = [
    ("results", 50, r"general updates", r"half yearly report"),
    # (category, base_priority, nse_desc regex, text regex)
    ("results", 80, r"outcome of board meeting|financial result", r"financial results|results for (the )?(quarter|period)|unaudited"),
    ("results", 30, r"investor presentation", r""),
    ("results", 10, r"newspaper publication", r"result"),
    ("management_change", 75, r"change in management|change in director|appointment|retirement|resignation|cessation", r""),
    ("M&A", 85, r"agreements?|acquisition|amalgamation|merger|scheme of arrangement|joint venture", r"joint venture|acquir|merger|stake|term sheet"),
    ("M&A", 85, r"general updates", r"term sheet|joint venture|acquire \d+%|acquisition of"),
    ("fund_raise", 70, r"allotment of securities|committee meeting|general updates", r"\bqip\b|qualified institutions|preferential|warrants|rights issue|buyback"),
    ("fund_raise", 10, r"general updates|commercial paper", r"commercial paper"),
    ("bonus_split", 40, r"bonus|split|sub-division", r""),
    ("litigation", 85, r"news verification|order|penalty|litigation|regulatory", r"\bhalt\b|\bban\b|warning letter|import alert|penalty|show cause|insolvency|quality lapse"),
    ("credit_rating", 45, r"credit rating", r""),
    ("press_release", 55, r"bagging|receiving of orders", r""),
    ("earnings_call", 40, r"analysts?/institutional investor meet|con\. call", r"transcript|recording|earnings call|earnings conference call|conference call on"),
    ("investor_meetings", 12, r"analysts?/institutional investor meet|con\. call|general updates", r"schedule of|meet|conference|roadshow|investor meet"),
    ("postal_ballot", 15, r"shareholders meeting", r"postal ballot"),
    ("agm_egm", 15, r"shareholders meeting", r"extraordinary general|annual general|\begm\b|\bagm\b"),
    ("dividend", 40, r"dividend|record date", r""),
    ("pledging", 60, r"pledge|encumbrance", r""),
    ("insider_trading", 45, r"insider trading|sast", r""),
    ("capex", 70, r"capacity|expansion", r"capex|new plant|capacity expansion"),
    ("press_release", 25, r"press release|updates", r""),
]

ROUTINE = r"esop|esos|esps|newspaper|dematerial|rta|registrar|commercial paper|redemption|monitoring agency|statement of deviation|change in auditors|certificate|compliance certificate|great place to work|copy of"

RED_FLAGS = [
    (r"restatement|prior period error", 18, "Auditor notes restated prior-period errors"),
    (r"(could not|unable to) comment|not been reviewed|lack of reviewed", 12, "Auditor could not review part of the numbers"),
    (r"qualified opinion|qualification|emphasis of matter", 15, "Audit qualification / emphasis of matter"),
    (r"\bhalt\b|\bban\b|import alert|warning letter", 10, "Regulator-ordered stoppage"),
]

SENIOR = r"\b(ceo|cfo|managing director|\bmd\b|chairman|chairperson|vice-chairman|chief compliance|chief risk|whole-time director|executive director)\b"


def classify(item):
    nse = (item.get("nse") or "").lower()
    text = (item.get("title", "") + " " + item.get("summary", "")).lower()
    cat, prio = "unclassified", 5
    for c, p, d_re, t_re in RULES:
        if re.search(d_re, nse) and (not t_re or re.search(t_re, text) or re.search(t_re, nse)):
            cat, prio = c, p
            break
    routine = bool(re.search(ROUTINE, nse + " " + text))
    if routine and cat in ("unclassified", "press_release", "investor_meetings", "results", "fund_raise"):
        if cat == "fund_raise" and re.search(r"commercial paper", text):
            prio = min(prio, 10)
        elif not (cat == "fund_raise" and re.search(r"\bqip\b|warrants|preferential", text)):
            cat, prio = ("unclassified" if cat != "results" else "results"), min(prio, 8)
    # management-change weighting: senior roles matter more than independent directors
    if cat == "management_change":
        if re.search(SENIOR, text):
            prio = 78
        elif re.search(r"independent director", text):
            prio = 58
        if re.search(r"re-?appoint", text):
            prio = 40
    if cat == "earnings_call" and re.search(r"recording|audio", text):
        prio = 15
    flags = []
    for rx, bump, label in RED_FLAGS:
        if re.search(rx, text):
            flags.append(label)
            prio += bump
    prio = max(0, min(100, prio))
    treatment = "brief" if prio >= 70 else ("line" if prio >= 35 else "fold")
    return {"category": cat, "priority": prio, "treatment": treatment, "flags": flags}


NAME_RX = re.compile(r"\b(?:Mr|Ms|Mrs|Dr)\.?\s+((?:[A-Z]\.\s?){0,3}[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+){0,2})")


def extract_people(item):
    """Pull person names out of the filing title/summary for entity resolution."""
    text = item.get("title", "") + " " + item.get("summary", "")
    return sorted({m.group(1).strip() for m in NAME_RX.finditer(text)})

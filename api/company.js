// GET /api/company?symbol=XYZ -> normalised fundamentals for ANY NSE ticker (public data only).
const { fetchCompany } = require("../lib/screener");
module.exports = async (req, res) => {
  try {
    const F = await fetchCompany(req.query.symbol);
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate=86400"); // CDN cache: one fetch per ticker per 12h
    res.status(200).json(F);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

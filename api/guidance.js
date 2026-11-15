// GET /api/guidance?symbol=XYZ -> promised vs delivered from the company's own concall transcripts.
const { fetchCompany } = require("../lib/screener");
const { promisedVsDelivered } = require("../lib/guidance");
module.exports = async (req, res) => {
  try {
    const F = await fetchCompany(req.query.symbol);
    const out = await promisedVsDelivered(F);
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400"); // transcripts change quarterly: cache a week
    res.status(200).json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

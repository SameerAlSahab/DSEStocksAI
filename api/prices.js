const { livePrices } = require('../lib/common');
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.json(await livePrices());
  } catch (e) { res.status(502).json({ error: e.message }); }
};

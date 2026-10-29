const { history } = require('../lib/common');
module.exports = async (req, res) => {
  const s = String(req.query.symbol || '').toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(s)) return res.status(400).json({ error: 'bad symbol' });
  try {
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json(await history(s));
  } catch (e) { res.status(502).json({ error: e.message }); }
};

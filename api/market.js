const { dse } = require('../lib/common');
module.exports = async (req, res) => {
  try {
    const iso = d => d.toISOString().slice(0, 10);
    const [m, st] = await Promise.all([
      dse('api/live/recent-market-info', { from: iso(new Date(Date.now() - 45 * 864e5)), to: iso(new Date()) }),
      dse('api/live/market').catch(() => ({}))]);
    const rows = (m.rows || []).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(-30);
    if (rows.length < 2) throw new Error('No market data');
    const L = rows.at(-1), P = rows.at(-2), pc = (a, b) => (b ? +((a / b - 1) * 100).toFixed(2) : null);
    const idx = k => ({ v: L[k], ch: +(L[k] - P[k]).toFixed(2), pct: pc(L[k], P[k]), series: rows.map(r => ({ date: r.date, close: r[k] })) });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.json({ date: L.date, phase: (st.session?.phase || '').replace(/_/g, ' '), dsex: idx('dsex'), dses: idx('dses'), ds30: idx('ds30'),
      trades: L.trades, volume: L.volume, value: L.value,
      pct: { trades: pc(L.trades, P.trades), volume: pc(L.volume, P.volume), value: pc(L.value, P.value) } });
  } catch (e) { res.status(502).json({ error: e.message }); }
};

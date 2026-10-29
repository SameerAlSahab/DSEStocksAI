const { dse } = require('../lib/common');
module.exports = async (req, res) => {
  try {
    const iso = d => d.toISOString().slice(0, 10);
    const base = { from: iso(new Date(Date.now() - 11 * 864e5)), to: iso(new Date()) }, P = 'api/live/data-archive/day-end';
    const first = await dse(P, base);
    let rows = first.rows || [];
    const size = first.pageSize || rows.length, pages = size ? Math.ceil((first.total || 0) / size) : 1;
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => dse(P, { ...base, page: i + 2 }).then(d => d.rows || []).catch(() => [])));
    rest.forEach(r => { rows = rows.concat(r); });
    const by = {};
    for (const r of rows) { const c = r.closep || r.ltp; if (c) (by[r.tradingCode] ||= []).push({ d: r.date, c, v: r.volume || 0 }); }
    const out = {};
    for (const [s, a] of Object.entries(by)) {
      a.sort((x, y) => (x.d > y.d ? 1 : -1)); const w = a.slice(-6); if (w.length < 3) continue;
      const c = w.map(x => x.c), last = c.at(-1), mean = c.reduce((x, y) => x + y, 0) / c.length;
      const mom = (last / c[0] - 1) * 100, pv = w.slice(0, -1).map(x => x.v), av = pv.reduce((x, y) => x + y, 0) / pv.length, vr = av ? w.at(-1).v / av : 1;
      const sc = (mom >= 2 ? 2 : mom > 0.5 ? 1 : mom <= -2 ? -2 : mom < -0.5 ? -1 : 0) + (last > mean ? 1 : -1);
      const sig = sc >= 2 ? 'Buy' : sc <= -2 ? 'Sell' : 'Hold';
      out[s] = { s: sig, c: Math.min(88, Math.round(50 + Math.abs(mom) * 3 + (vr >= 1.5 ? 6 : 0) + Math.abs(sc) * 3)), h: sig === 'Buy' && vr >= 1.5 ? 1 : 0, sp: c, m: +mom.toFixed(2), vr: +vr.toFixed(2) };
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.json({ asOf: rows.map(r => r.date).sort().at(-1) || null, signals: out });
  } catch (e) { res.status(502).json({ error: e.message }); }
};

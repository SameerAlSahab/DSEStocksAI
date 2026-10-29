const { history, indicators, technicalSignal, askAI } = require('../lib/common');
const { translate } = require('../lib/translate');
module.exports = async (req, res) => {
  const s = String(req.query.symbol || '').toUpperCase();
  if (!/^[A-Z0-9._&-]{1,20}$/.test(s)) return res.status(400).json({ error: 'bad symbol' });
  const lang = req.query.lang === 'bn' ? 'bn' : 'en';
  try {
    const rows = await history(s);
    const ind = indicators(rows);
    if (!ind) return res.status(404).json({ error: 'Not enough history for ' + s });
    const prompt = `You are a quantitative analyst for the Dhaka Stock Exchange. Stock: ${s}.
Indicators (oldest to newest closes in last10): ${JSON.stringify(ind)}.
Predict the likely direction of the NEXT trading day. Reply with ONLY JSON:
{"direction":"UP"|"DOWN"|"NEUTRAL","confidence":0-100,"reason":"max 40 words"}`;
    const ai = await askAI(prompt);
    let out = null;
    if (ai.text) { const m = ai.text.match(/\{[\s\S]*\}/); try { out = JSON.parse(m[0]); } catch {} }
    const ok = out && ['UP', 'DOWN', 'NEUTRAL'].includes(String(out.direction).toUpperCase());
    const result = ok ? { ...out, direction: out.direction.toUpperCase(), source: ai.provider } : { ...technicalSignal(ind), source: 'rules (AI unavailable)' };
    let translatedBy = null;
    if (lang === 'bn' && result.reason) { const t = await translate(result.reason, 'bn'); result.reason = t.text; translatedBy = t.by; }
    const aiDown = !ok;
    const aiCodes = aiDown ? [...new Set(ai.tried.map(m => (String(m).match(/\s([45]\d\d)\s/) || [])[1]).filter(Boolean))] : [];
    res.setHeader('Cache-Control', aiDown ? 's-maxage=60' : 's-maxage=900');
    res.json({ symbol: s, lang, translatedBy, indicators: ind, prediction: result, aiDown, aiCodes, keysFound: ai.keysFound,
      disclaimer: 'Educational only, not financial advice.' });
  } catch (e) { res.status(502).json({ error: e.message }); }
};

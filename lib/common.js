const DSE = 'https://dse.com.bd/';

async function dse(path, params = {}) {
  const u = new URL(path, DSE);
  Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error('DSE HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; }
  }
  throw err;
}

async function livePrices() {
  const d = await dse('api/live/prices');
  return d.rows.map(v => Object.fromEntries(d.cols.map((c, i) => [c, v[i]])))
    .filter(r => r.board === 'PUBLIC')
    .map(r => ({ symbol: r.code, ltp: r.ltp, high: r.high, low: r.low, close: r.close, ycp: r.ycp,
      change: r.ltp != null && r.ycp != null && r.ltp ? +(r.ltp - r.ycp).toFixed(2) : null,
      percent: r.percent, trade: r.trades, value: r.value, volume: r.volume }));
}

async function history(symbol, days = 120) {
  const iso = d => d.toISOString().slice(0, 10);
  const to = new Date(), from = new Date(Date.now() - days * 864e5);
  const d = await dse('api/live/data-archive/day-end', { from: iso(from), to: iso(to), inst: symbol });
  return (d.rows || []).map(r => ({ date: r.date, open: r.openp, high: r.high, low: r.low,
    close: r.closep || r.ltp, volume: r.volume })).filter(r => r.close)
    .sort((a, b) => (a.date > b.date ? 1 : -1)); // oldest first
}

const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((x, y) => x + y, 0) / n : null;
function ema(a, n) { const k = 2 / (n + 1); let e = a[0]; const out = [e]; for (let i = 1; i < a.length; i++) { e = a[i] * k + e * (1 - k); out.push(e); } return out; }
function rsi(a, n = 14) {
  if (a.length <= n) return null; let g = 0, l = 0;
  for (let i = a.length - n; i < a.length; i++) { const d = a[i] - a[i - 1]; d > 0 ? g += d : l -= d; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function indicators(rows) {
  const c = rows.map(r => r.close); if (c.length < 15) return null;
  const e12 = ema(c, 12), e26 = ema(c, 26), macd = e12.map((v, i) => v - e26[i]), sig = ema(macd, 9);
  const last = c.at(-1), r2 = x => x == null ? null : +x.toFixed(2);
  return { last, sma5: r2(sma(c, 5)), sma20: r2(sma(c, 20)), sma50: r2(sma(c, 50)), rsi14: r2(rsi(c)),
    macd: r2(macd.at(-1)), macdSignal: r2(sig.at(-1)), mom5pct: c.length > 5 ? r2((last / c.at(-6) - 1) * 100) : null,
    last10: c.slice(-10) };
}

function technicalSignal(ind) {
  let s = 0;
  if (ind.sma20 && ind.last > ind.sma20) s++; else if (ind.sma20) s--;
  if (ind.macd > ind.macdSignal) s++; else s--;
  if (ind.rsi14 > 70) s--; else if (ind.rsi14 < 30) s++;
  if (ind.mom5pct > 0) s++; else s--;
  return { direction: s > 0 ? 'UP' : s < 0 ? 'DOWN' : 'NEUTRAL', confidence: Math.min(50 + Math.abs(s) * 8, 80),
    reason: 'Rule-based signal from SMA20, MACD, RSI14 and 5-day momentum.' };
}


const keys = n => (process.env[n] || '').split(',').map(s => s.trim()).filter(Boolean);
const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
const clean = s => String(s).replace(/[A-Za-z0-9_\-.]{24,}/g, '***').replace(/\s+/g, ' ').slice(0, 110);

async function getJSON(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(r.status + ' listing models');
  return r.json();
}
const cache = {};
async function models(name, loader) {
  if (!cache[name] || Date.now() - cache[name].t > 6e5) cache[name] = { t: Date.now(), v: await loader() };
  return cache[name].v;
}
const BAD = /whisper|guard|tts|orpheus|embed|image|audio|live|vision-only|moderation|safeguard|robotics|veo|imagen/i;


const pickGroq = key => models('groq', async () => {
  const ids = (await getJSON('https://api.groq.com/openai/v1/models', { Authorization: 'Bearer ' + key })).data.map(m => m.id).filter(i => !BAD.test(i));
  const pref = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
  return [...pref.filter(p => ids.includes(p)), ...ids.filter(i => !pref.includes(i) && !/compound/.test(i))];
});
const pickOpenRouter = key => models('openrouter', async () => {
  const d = (await getJSON('https://openrouter.ai/api/v1/models', { Authorization: 'Bearer ' + key })).data;
  const free = d.filter(m => /:free$/.test(m.id) && !BAD.test(m.id) && (m.architecture?.output_modalities || ['text']).join() === 'text');
  const score = m => (/gpt-oss|llama-3\.3|llama-4|qwen3|deepseek|gemma|mistral/.test(m.id) ? 1e7 : 0) + (m.context_length || 0);
  return free.sort((a, b) => score(b) - score(a)).map(m => m.id);
});
const pickGemini = key => models('gemini', async () => {
  const d = (await getJSON('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key })).models;
  const ok = d.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', '')).filter(i => /^gemini-/.test(i) && !BAD.test(i) && !/exp|preview|thinking|lite/.test(i));
  const flash = ok.filter(i => /flash/.test(i)).sort().reverse(), rest = ok.filter(i => !/flash/.test(i)).sort().reverse();
  return [...flash, ...rest];
});

async function errBody(r, name) { let t = ''; try { t = await r.text(); } catch {} return new Error(`${name} ${r.status} ${clean(t)}`); }

const oaRun = (name, url, listFn, envModel, key) => async prompt => {
  const list = process.env[envModel] ? [process.env[envModel]] : await listFn(key);
  let last = new Error(name + ' no models available');
  for (const model of list.slice(0, 2)) {
    const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1500, ...(/gpt-oss/.test(model) && name === 'groq' ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'user', content: prompt }] }) });
    if (r.ok) { const t = (await r.json()).choices?.[0]?.message?.content; if (t) return t; last = new Error(name + ' empty reply'); continue; }
    last = await errBody(r, name + ':' + model);
    if (r.status === 401 || r.status === 403) throw last; // bad key: don't try other models
  }
  throw last;
};
const geminiRun = key => async prompt => {
  const list = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : await pickGemini(key);
  let last = new Error('gemini no models available');
  for (const m of list.slice(0, 2)) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (r.ok) { const t = ((await r.json()).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''); if (t) return t; last = new Error('gemini empty reply'); continue; }
    last = await errBody(r, 'gemini:' + m);
    if (r.status === 400 || r.status === 401 || r.status === 403) { if (/API key|PERMISSION|invalid/i.test(last.message)) throw last; }
  }
  throw last;
};

function pool() {
  const p = [];
  keys('GROQ_API_KEYS').forEach(k => p.push({ name: 'groq', run: oaRun('groq', 'https://api.groq.com/openai/v1/chat/completions', pickGroq, 'GROQ_MODEL', k) }));
  keys('OPENROUTER_API_KEYS').forEach(k => p.push({ name: 'openrouter', run: oaRun('openrouter', 'https://openrouter.ai/api/v1/chat/completions', pickOpenRouter, 'OPENROUTER_MODEL', k) }));
  keys('GEMINI_API_KEYS').forEach(k => p.push({ name: 'gemini', run: geminiRun(k) }));
  if (process.env.CUSTOM_BASE_URL && process.env.CUSTOM_MODEL) keys('CUSTOM_API_KEYS').forEach(k => p.push({ name: 'custom', run: oaRun('custom', process.env.CUSTOM_BASE_URL, async () => [], 'CUSTOM_MODEL', k) }));
  return shuffle(p);
}

async function askAI(prompt, opts = {}) {
  const tried = [], all = pool().filter(p => !opts.only || p.name === opts.only), t0 = Date.now();

  const seen = new Set(), first = [], rest = [];
  for (const p of all) { (seen.has(p.name) ? rest : first).push(p); seen.add(p.name); }
  const go = p => p.run(prompt).then(text => ({ provider: p.name, text }), e => { tried.push(e.message); throw e; });
  try { const w = await Promise.any(first.map(go)); return { ...w, tried, keysFound: all.length }; } catch {}

  for (const p of rest) {
    if (Date.now() - t0 > 35000) break;
    try { return { ...(await go(p)), tried, keysFound: all.length }; } catch {}
  }
  return { provider: null, text: null, tried, keysFound: all.length };
}

module.exports = { dse, livePrices, history, indicators, technicalSignal, askAI };

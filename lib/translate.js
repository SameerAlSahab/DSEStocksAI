const { askAI } = require('./common');

const PUBLIC = ['https://lingva.ml', 'https://lingva.garudalinux.org', 'https://translate.plausibility.cloud', 'https://lingva.lunar.icu'];
const own = () => (process.env.LINGVA_URLS || process.env.LINGVA_URL || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
const SCRIPT = { bn: /[ঀ-৿]/ };
const cache = new Map();

async function lingva(base, text, to) {
  const r = await fetch(`${base}/api/v1/en/${to}/${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('lingva HTTP ' + r.status);
  const t = (await r.json()).translation;
  if (typeof t !== 'string' || !t.trim()) throw new Error('lingva empty');
  if (SCRIPT[to] && !SCRIPT[to].test(t)) throw new Error('lingva returned untranslated text');
  return t.trim();
}


async function google(text, to) {
  const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${to}&dt=t&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('google HTTP ' + r.status);
  const t = ((await r.json())[0] || []).map(x => x[0] || '').join('').trim();
  if (!t || (SCRIPT[to] && !SCRIPT[to].test(t))) throw new Error('google empty');
  return t;
}
async function myMemory(text, to) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${to}`, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('mymemory HTTP ' + r.status);
  const t = String((await r.json()).responseData?.translatedText || '').trim();
  if (!t || /MYMEMORY|QUERY LENGTH/i.test(t) || (SCRIPT[to] && !SCRIPT[to].test(t))) throw new Error('mymemory bad');
  return t;
}


async function viaFree(text, to) {
  for (const b of own()) { try { return await lingva(b, text, to); } catch {} }
  return Promise.any([google(text, to), myMemory(text, to), ...PUBLIC.map(b => lingva(b, text, to))]);
}

async function viaGemini(text, to) {
  const lang = { bn: 'Bangla (Bengali script, formal register)' }[to];
  const ai = await askAI(`Translate the following stock-market commentary from English to ${lang}. Keep tickers, numbers, and indicator names (RSI, SMA, MACD) unchanged. Reply with ONLY the translation.\n\n${text}`, { only: 'gemini' });
  if (!ai.text) throw new Error('gemini unavailable');
  const t = ai.text.trim().replace(/^["“]|["”]$/g, '');
  if (SCRIPT[to] && !SCRIPT[to].test(t)) throw new Error('gemini returned untranslated text');
  return t;
}


const chunks = text => {
  const out = []; let cur = '';
  for (const s of text.split(/(?<=[.!?])\s+/)) { if ((cur + ' ' + s).length > 350 && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s; }
  if (cur) out.push(cur);
  return out;
};

async function translate(text, to = 'bn') {
  text = String(text || '').trim();
  if (!text || to === 'en') return { text, by: null };
  const key = to + '|' + text;
  if (cache.has(key)) return cache.get(key);
  let res;
  try { res = { text: (await Promise.all(chunks(text).map(c => viaFree(c, to)))).join(' '), by: 'free' }; }
  catch {
    try { res = { text: await viaGemini(text, to), by: 'gemini' }; }
    catch { res = { text, by: null }; }
  }
  if (res.by) { if (cache.size > 500) cache.clear(); cache.set(key, res); }
  return res;
}

module.exports = { translate };

const axios = require('axios');

const cache = new Map();

function normalize(text) {
  return (text || '').toString().trim();
}

function isMostlyKorean(text) {
  const s = normalize(text);
  if (!s) return false;
  let hangul = 0;
  let letters = 0;
  for (const ch of s) {
    if (/[A-Za-z0-9]/.test(ch)) letters += 1;
    if (/[°¡-ÆR]/.test(ch)) { hangul += 1; letters += 1; }
  }
  if (letters === 0) return false;
  return (hangul / letters) >= 0.3 || hangul >= 6;
}

async function translateToKo(text) {
  const input = normalize(text);
  if (!input) return '';
  if (isMostlyKorean(input)) return input;
  if (cache.has(input)) return cache.get(input);

  try {
    const res = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: {
        client: 'gtx',
        sl: 'auto',
        tl: 'ko',
        dt: 't',
        q: input,
      },
      timeout: 6000,
      validateStatus: () => true,
    });

    if (!Array.isArray(res.data)) {
      cache.set(input, input);
      return input;
    }

    const chunks = res.data[0] || [];
    const translated = chunks.map((c) => c[0]).join('');
    const output = normalize(translated) || input;
    cache.set(input, output);
    return output;
  } catch {
    return input;
  }
}

module.exports = { translateToKo };

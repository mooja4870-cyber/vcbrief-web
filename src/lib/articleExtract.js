const axios = require('axios');

function decodeEntities(str) {
  if (!str) return '';
  let s = str;
  s = s.replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'")
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&nbsp;/g, ' ')
       .replace(/&ndash;/g, '-')
       .replace(/&mdash;/g, '--');
  s = s.replace(/&#(\d+);/g, (m, code) => {
    const n = parseInt(code, 10);
    return Number.isFinite(n) ? String.fromCharCode(n) : m;
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (m, code) => {
    const n = parseInt(code, 16);
    return Number.isFinite(n) ? String.fromCharCode(n) : m;
  });
  return s;
}

function stripTags(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  return s;
}

function collapseWhitespace(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function getAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : '';
}

function extractMetaDescription(html) {
  const metaTags = html.match(/<meta[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = (getAttr(tag, 'name') || getAttr(tag, 'property')).toLowerCase();
    if (!name) continue;
    if (name === 'description' || name === 'og:description' || name === 'twitter:description') {
      const content = getAttr(tag, 'content');
      if (content) return decodeEntities(content);
    }
  }
  return '';
}

function extractFirstParagraph(html) {
  const blocks = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  for (const block of blocks) {
    const text = collapseWhitespace(decodeEntities(stripTags(block)));
    if (text.length >= 40) return text;
  }
  if (blocks.length > 0) {
    return collapseWhitespace(decodeEntities(stripTags(blocks[0])));
  }
  return '';
}

function trimTo(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, Math.max(0, max - 3)).trim() + '...';
}

function ensurePeriod(str) {
  if (!str) return '';
  const s = str.trim();
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

async function fetchArticleHtml(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
      headers: { 'User-Agent': 'VCBriefBot/1.0' },
    });
    const ct = (res.headers['content-type'] || '').toLowerCase();
    if (typeof res.data === 'string') {
      if (ct.includes('text/html') || res.data.toLowerCase().includes('<html')) {
        return res.data;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function makeSummaryLines({ title, source, tags, theme, html, rssSummary, insight, mode }) {
  const meta = extractMetaDescription(html || '');
  const para = extractFirstParagraph(html || '');
  const isDecision = mode === 'decision';
  const line1 = `<${source}>`;

  const summaryText = rssSummary || meta || para;
  const line2Label = isDecision ? '\uACB0\uC815 \uC694\uC57D' : '';

  const line3Label = isDecision ? '\uD22C\uC790 \uD310\uB2E8' : '\uD22C\uC790 \uC2DC\uC0AC\uC810';
  const line2 = summaryText
    ? (line2Label ? `${line2Label}: ${trimTo(summaryText, 140)}` : trimTo(summaryText, 140))
    : (line2Label ? `${line2Label}: ${theme} \uAD00\uB828 \uC774\uC288 \uC694\uC57D` : `${theme} \uAD00\uB828 \uC774\uC288 \uC694\uC57D`);

  const insightText = insight || `${theme} \uAD00\uB828 \uC9C0\uD45C \uBCC0\uB3D9\uACFC \uACBD\uC7C1 \uAD6C\uB3C4 \uC810\uAC80 \uD544\uC694`;
  const line3 = `${line3Label}: ${ensurePeriod(insightText)}`;

  return [line1, line2, line3];
}

module.exports = {
  decodeEntities,
  extractMetaDescription,
  extractFirstParagraph,
  fetchArticleHtml,
  makeSummaryLines,
};





const axios = require('axios');

function googleNewsRss(query, options = {}) {
  const lang = options.lang || 'ko';
  const country = options.country || 'KR';
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${lang}&gl=${country}&ceid=${country}:${lang}`;
}

const RSS_SOURCES = [
  { name: '더브이씨 (THE VC)', url: googleNewsRss('site:thevc.kr'), region: 'domestic' },
  { name: '딜사이트 (Dealsite)', url: googleNewsRss('site:dealsite.co.kr'), region: 'domestic' },
  { name: '더벨 (thebell)', url: googleNewsRss('site:thebell.co.kr'), region: 'domestic' },
  { name: '플래텀 (Platum)', url: 'https://platum.kr/feed', region: 'domestic' },
  { name: '머니투데이 유니콘팩토리', url: googleNewsRss('site:unicornfactory.co.kr'), region: 'domestic' },
  { name: '벤처스퀘어 (VentureSquare)', url: 'https://venturesquare.net/feed', region: 'domestic' },
  { name: '전자신문 (Electronic Times)', url: 'https://rss.etnews.com/Section901.xml', region: 'domestic' },
  { name: '지디넷코리아 (ZDNet Korea)', url: 'https://feeds.feedburner.com/zdkorea', region: 'domestic' },
  { name: '블로터 (Bloter)', url: 'https://cdn.bloter.net/rss/gns_allArticle.xml', region: 'domestic' },
  { name: '한국벤처투자 (KVIC)', url: googleNewsRss('site:kvic.or.kr'), region: 'domestic' },
  { name: '한국벤처캐피탈협회 (KVCA)', url: googleNewsRss('site:kvca.or.kr'), region: 'domestic' },
  { name: '헬로디디 (HelloDD)', url: googleNewsRss('site:hellodd.com'), region: 'domestic' },
  { name: '스타트업 위클리 (Startup Weekly)', url: googleNewsRss('"스타트업 위클리" OR "Startup Weekly"'), region: 'domestic' },
  { name: '미라클레터', url: googleNewsRss('"미라클레터" OR "Miracle Letter"'), region: 'domestic' },
  { name: '위클리 딥 다이브 (Weekly Deep Dive)', url: googleNewsRss('"위클리 딥 다이브" OR "Weekly Deep Dive"'), region: 'domestic' },
  { name: '뉴닉 (NEWNEEK)', url: googleNewsRss('site:newneek.co'), region: 'domestic' },
  { name: '어피티 (UPPITY)', url: googleNewsRss('site:uppity.co.kr'), region: 'domestic' },
  { name: '부딩 (BOODING)', url: googleNewsRss('"부딩" OR "BOODING"'), region: 'domestic' },
  { name: '순살브리핑 (Soonsal)', url: googleNewsRss('site:soonsal.com OR "순살브리핑"'), region: 'domestic' },
  { name: '커리어리 (Careerly)', url: googleNewsRss('site:careerly.co.kr'), region: 'domestic' },
  { name: 'PitchBook', url: googleNewsRss('site:pitchbook.com/news', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'global' },
  { name: 'Sifted', url: 'https://sifted.eu/feed', region: 'global' },
  { name: 'CB Insights', url: googleNewsRss('site:cbinsights.com/research', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'PE Hub', url: 'https://www.pehub.com/feed', region: 'global' },
  { name: 'Axios Pro', url: googleNewsRss('"Axios Pro" "venture capital"', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'StrictlyVC', url: googleNewsRss('site:strictlyvc.com', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'VentureBeat', url: 'https://venturebeat.com/feed/', region: 'global' },
  { name: 'Fortune Term Sheet', url: googleNewsRss('"Fortune Term Sheet"', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'a16z (Andreessen Horowitz)', url: 'https://a16z.com/feed/', region: 'global' },
  { name: 'Crunchbase News', url: 'https://news.crunchbase.com/feed/', region: 'global' },
  { name: 'First Round Review', url: googleNewsRss('site:review.firstround.com', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'Not Boring', url: 'https://www.notboring.co/feed', region: 'global' },
  { name: 'The Generalist', url: 'https://thegeneralist.substack.com/feed', region: 'global' },
  { name: 'Benedict Evans Newsletter', url: 'https://www.ben-evans.com/benedictevans?format=rss', region: 'global' },
  { name: 'WSJ Pro Venture Capital', url: googleNewsRss('"WSJ Pro Venture Capital"', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'Y Combinator (Blog)', url: 'https://www.ycombinator.com/blog/rss', region: 'global' },
  { name: 'Product Hunt Daily', url: 'https://www.producthunt.com/feed', region: 'global' },
  { name: 'McKinsey Private Markets', url: googleNewsRss('site:mckinsey.com "private markets"', { lang: 'en', country: 'US' }), region: 'global' },
  { name: 'Bain Global VC Outlook', url: googleNewsRss('site:bain.com "global vc outlook"', { lang: 'en', country: 'US' }), region: 'global' },
];

function decodeHtml(str) {
  if (!str) return '';
  let s = str;
  s = s.replace(/<!\[CDATA\[/g, '')
       .replace(/\]\]>/g, '')
       .replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'")
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&nbsp;/g, ' ');
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
  return html.replace(/<[^>]+>/g, ' ');
}

function collapseWhitespace(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeHtml(m[1].trim()) : '';
}

function extractLink(block) {
  let link = extractTag(block, 'link');
  if (link) return link;

  const linkHref = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (linkHref) return decodeHtml(linkHref[1].trim());

  const guid = extractTag(block, 'guid');
  return guid || '';
}

function extractAtomLink(block) {
  const alt = block.match(/<link[^>]+rel=["']alternate["'][^>]*>/i);
  if (alt) {
    const href = alt[0].match(/href=["']([^"']+)["']/i);
    if (href) return decodeHtml(href[1].trim());
  }
  const linkHref = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (linkHref) return decodeHtml(linkHref[1].trim());
  const linkText = extractTag(block, 'link');
  return linkText || '';
}

async function fetchRss(url, source, region = 'domestic') {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { 'User-Agent': 'VCBriefBot/1.0' },
    });
    if (res.status >= 400 || !res.data) return [];

    const xml = res.data.toString();
    const itemBlocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
    const entryBlocks = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];

    const blocks = [
      ...itemBlocks.map((block) => ({ block, isAtom: false })),
      ...entryBlocks.map((block) => ({ block, isAtom: true })),
    ];

    const items = blocks.map(({ block, isAtom }) => {
      const title = extractTag(block, 'title');
      const url_original = isAtom ? extractAtomLink(block) : extractLink(block);
      const pubDate = extractTag(block, 'pubDate')
        || extractTag(block, 'dc:date')
        || extractTag(block, 'updated')
        || extractTag(block, 'published');
      const description = extractTag(block, 'description') || extractTag(block, 'summary');
      const content = extractTag(block, 'content:encoded') || extractTag(block, 'content');
      const summary = collapseWhitespace(stripTags(description || content || ''));
      const published_at = (() => {
        const d = new Date(pubDate);
        return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      })();

      return { title, url_original, published_at, source, summary, region };
    });

    return items.filter((i) => i.title && i.url_original);
  } catch {
    return [];
  }
}

module.exports = { RSS_SOURCES, fetchRss };

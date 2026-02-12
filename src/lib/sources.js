const axios = require('axios');

const RSS_SOURCES = [
  { name: '한국경제 IT', url: 'https://www.hankyung.com/feed/it', region: 'domestic' },
  { name: '한국경제 경제', url: 'https://www.hankyung.com/feed/economy', region: 'domestic' },
  { name: '한국경제 금융', url: 'https://www.hankyung.com/feed/finance', region: 'domestic' },
  { name: '연합뉴스TV 경제', url: 'http://www.yonhapnewstv.co.kr/category/news/economy/feed/', region: 'domestic', maxItems: 4 },
  { name: '뉴시스 경제', url: 'https://www.newsis.com/RSS/economy.xml', region: 'domestic' },
  { name: '뉴시스 산업', url: 'https://www.newsis.com/RSS/industry.xml', region: 'domestic' },
  { name: '뉴시스 IT·바이오', url: 'https://www.newsis.com/RSS/health.xml', region: 'domestic' },
  { name: '아이뉴스24 IT', url: 'https://www.inews24.com/rss/news_it.xml', region: 'domestic' },
  { name: '아이뉴스24 경제', url: 'https://www.inews24.com/rss/news_economy.xml', region: 'domestic' },
  { name: '플래텀', url: 'https://platum.kr/feed', region: 'domestic' },
  { name: '벤처스퀘어', url: 'https://venturesquare.net/feed', region: 'domestic' },
  { name: '아웃스탠딩', url: 'https://outstanding.kr/feed', region: 'domestic' },
  { name: '블로터', url: 'https://cdn.bloter.net/rss/gns_allArticle.xml', region: 'domestic' },
  { name: 'ZDNet Korea', url: 'https://feeds.feedburner.com/zdkorea', region: 'domestic' },
  { name: '전자신문', url: 'http://rss.etnews.com/Section901.xml', region: 'domestic' },
  { name: 'IT조선', url: 'https://cdn.it.chosun.com/rss/gns_allArticle.xml', region: 'domestic' },
  { name: '디지털데일리', url: 'https://www.ddaily.co.kr/rss.xml', region: 'domestic' },
  { name: '중소벤처기업부 보도자료', url: 'https://mss.go.kr/rss/smba/board/86.do', region: 'domestic', maxItems: 4 },
  { name: '중소벤처기업부 사업공고', url: 'https://mss.go.kr/rss/smba/board/310.do', region: 'domestic', maxItems: 4 },
  { name: '머니투데이', url: 'https://rss.mt.co.kr/mt_news.xml', region: 'domestic', maxItems: 6 },
  { name: 'KoreaTechToday', url: 'https://www.koreatechtoday.com/feed', region: 'domestic' },
  { name: 'KoreaTechDesk', url: 'https://www.koreatechdesk.com/feed', region: 'domestic' },
  { name: 'Reuters Technology', url: 'https://feeds.reuters.com/reuters/technologyNews', region: 'global' },
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews', region: 'global' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'global' },
  { name: 'VentureBeat', url: 'https://venturebeat.com/feed/', region: 'global' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', region: 'global' },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', region: 'global' },
  { name: 'CNBC Technology', url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', region: 'global' },
  { name: 'CNBC World', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', region: 'global' },
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', region: 'global' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', region: 'global' },
  { name: 'Crunchbase News', url: 'https://news.crunchbase.com/feed/', region: 'global' },
  { name: 'Sequoia Capital', url: 'https://www.sequoiacap.com/feed/', region: 'global' },
  { name: 'NVCA', url: 'https://nvca.org/feed/', region: 'global' },
  { name: 'CB Insights', url: 'https://www.cbinsights.com/research/feed', region: 'global' },
  { name: 'The Generalist', url: 'https://thegeneralist.substack.com/feed', region: 'global' },
  { name: 'Not Boring', url: 'https://www.notboring.co/feed', region: 'global' },
  { name: 'AVC', url: 'https://avc.com/feed', region: 'global' },
  { name: 'Sifted', url: 'https://sifted.eu/feed', region: 'global' },
  { name: 'AltAssets', url: 'https://www.altassets.net/feed', region: 'global' },
  { name: 'Private Equity International', url: 'https://www.privateequityinternational.com/feed', region: 'global' },
  { name: 'PE Hub', url: 'https://www.pehub.com/feed', region: 'global' },
  { name: 'Private Equity Wire', url: 'https://www.privateequitywire.co.uk/feed', region: 'global' },
  { name: 'Y Combinator Blog', url: 'https://www.ycombinator.com/blog/rss', region: 'global' },
  { name: 'Lightspeed Venture Partners', url: 'https://lsvp.com/feed', region: 'global' },
  { name: 'McKinsey', url: 'https://www.mckinsey.com/rss', region: 'global', maxItems: 6 },
  { name: 'a16z Podcast', url: 'https://feeds.simplecast.com/JGE3yC0V', region: 'global', maxItems: 6 },
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

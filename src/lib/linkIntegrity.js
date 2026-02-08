const axios = require('axios');

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isValidUrl(value) {
  return !!safeParseUrl(value);
}

function extractDomain(url) {
  const parsed = safeParseUrl(url);
  return parsed ? parsed.hostname : '';
}

async function resolveFinalUrl(original_url) {
  if (!original_url || typeof original_url !== 'string') {
    return {
      final_url: original_url || '',
      link_status: 'unverified',
      verification_note: 'missing url_original',
    };
  }

  if (!isValidUrl(original_url)) {
    return {
      final_url: original_url,
      link_status: 'unverified',
      verification_note: 'invalid url_original',
    };
  }

  const opts = {
    maxRedirects: 5,
    timeout: 8000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'VCBriefBot/1.0' },
  };

  try {
    const head = await axios.head(original_url, opts);
    const finalUrl =
      head.request?.res?.responseUrl ||
      head.request?._redirectable?._currentUrl ||
      head.config?.url ||
      original_url;

    if (head.status >= 200 && head.status < 400) {
      return { final_url: finalUrl, link_status: 'verified', verification_note: '' };
    }

    const getRes = await axios.get(original_url, opts);
    const getFinalUrl =
      getRes.request?.res?.responseUrl ||
      getRes.request?._redirectable?._currentUrl ||
      getRes.config?.url ||
      original_url;

    if (getRes.status >= 200 && getRes.status < 400) {
      return { final_url: getFinalUrl, link_status: 'verified', verification_note: '' };
    }

    return {
      final_url: getFinalUrl,
      link_status: 'broken',
      verification_note: `HTTP ${getRes.status}`,
    };
  } catch (err) {
    return {
      final_url: original_url,
      link_status: 'unverified',
      verification_note: `request failed: ${err.message || 'unknown error'}`,
    };
  }
}

function extractCanonical(html, currentUrl) {
  if (!html || typeof html !== 'string') return null;
  const tagMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  if (!tagMatch) return null;

  const hrefMatch = tagMatch[0].match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) return null;

  const href = hrefMatch[1].trim();
  if (!href) return null;

  if (isValidUrl(href)) return href;
  if (!isValidUrl(currentUrl)) return null;

  try {
    return new URL(href, currentUrl).toString();
  } catch {
    return null;
  }
}

function chooseBestUrl({ canonical_url, final_url, url_original }) {
  if (isValidUrl(canonical_url)) return canonical_url;
  if (isValidUrl(final_url)) return final_url;
  if (isValidUrl(url_original)) return url_original;
  return '';
}

function buildLinkMeta({ url_original, final_url, canonical_url, link_status, verification_note }) {
  const bestUrl = chooseBestUrl({ canonical_url, final_url, url_original });
  let status = link_status;
  let note = verification_note || '';

  if (!status) {
    status = bestUrl ? 'verified' : 'unverified';
  }

  if (!bestUrl) {
    status = 'unverified';
    if (!note) note = 'missing or invalid url';
  }

  if ((status === 'unverified' || status === 'broken') && !note) {
    note = 'link verification failed';
  }

  const domain = extractDomain(bestUrl);
  return { domain, link_status: status, verification_note: note };
}

module.exports = {
  safeParseUrl,
  isValidUrl,
  extractDomain,
  resolveFinalUrl,
  extractCanonical,
  chooseBestUrl,
  buildLinkMeta,
};

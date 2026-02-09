import React from 'react';
import { NewsItem } from '../types';

interface NewsCardProps {
  item: NewsItem;
  rank: number;
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreToTier(score: number) {
  if (score >= 90) return '상위 10% 신호';
  if (score >= 80) return '상위 20% 신호';
  if (score >= 70) return '상위 30% 신호';
  if (score >= 60) return '상위 40% 신호';
  return '관찰 필요 신호';
}

function formatSourceLabel(source: string) {
  const normalized = String(source || '').trim();
  if (!normalized) return normalized;

  const exactMap: Record<string, string> = {
    '뉴시스 경제': '뉴시스 | 경제',
    '뉴시스 산업': '뉴시스 | 산업',
    '뉴시스 IT·바이오': '뉴시스 | IT·바이오',
    '한국경제 IT': '한국경제 | IT',
    '한국경제 경제': '한국경제 | 경제',
    '한국경제 금융': '한국경제 | 금융',
    '연합뉴스TV 경제': '연합뉴스TV | 경제',
    '연합뉴스TV 최신': '연합뉴스TV | 최신',
    '아이뉴스24 IT': '아이뉴스24 | IT',
    '아이뉴스24 경제': '아이뉴스24 | 경제',
    'Reuters Technology': 'Reuters | Technology',
    'Reuters Business': 'Reuters | Business',
    'CNBC Technology': 'CNBC | Technology',
    'CNBC World': 'CNBC | World',
    'BBC Technology': 'BBC | Technology',
    'BBC Business': 'BBC | Business',
  };
  if (exactMap[normalized]) return exactMap[normalized];

  const prefixMatch = normalized.match(/^(뉴시스|한국경제|연합뉴스TV|아이뉴스24|Reuters|CNBC|BBC)\s+(.+)$/);
  if (prefixMatch) {
    return `${prefixMatch[1]} | ${prefixMatch[2].trim()}`;
  }
  return normalized;
}

function formatPublishedAt(value: string, region?: NewsItem['region']) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  // 국내 기사는 원문 기사 시각과 맞추기 위해 KST 기준으로 고정 표기한다.
  if (region === 'domestic') {
    const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return `${kst.toISOString().replace('T', ' ').slice(0, 19)} KST`;
  }

  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

const NewsCard: React.FC<NewsCardProps> = ({ item, rank }) => {
  const canLink = item.url && isValidUrl(item.url) && item.link_status !== 'broken';
  const isGlobal = String(item.region || '').toLowerCase() === 'global';

  const summaryLines = Array.isArray(item.summary_3lines)
    ? item.summary_3lines.filter(Boolean)
    : String(item.summary_3lines || '').split('\n').filter(Boolean);

  const breakdown = [
    ['impact', clampScore(item.score_breakdown?.impact || 0)],
    ['relevance', clampScore(item.score_breakdown?.relevance || 0)],
    ['urgency', clampScore(item.score_breakdown?.urgency || 0)],
    ['credibility', clampScore(item.score_breakdown?.credibility || 0)],
  ] as const;

  return (
    <article className="signal-row signal-row-execution">
      <div className="signal-row-main">
        <div className="signal-headline-row">
          <h3 className="signal-headline">
            <span className="signal-rank-inline">#{rank}</span>
            {canLink ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="signal-link-title">
                {item.title}
              </a>
            ) : (
              <span>{item.title}</span>
            )}
          </h3>

          <div className="signal-score-panel">
            <p className="signal-score-label">{scoreToTier(item.score_total)}</p>
            <div className="signal-score-bar">
              <span style={{ width: `${clampScore(item.score_total)}%` }} />
            </div>
          </div>
        </div>

        <div className="signal-sub-row">
          <span className={`region-pill ${isGlobal ? 'region-pill-global' : 'region-pill-domestic'}`}>
            {isGlobal ? 'G' : 'D'}
          </span>
          <span>{formatSourceLabel(item.source)}</span>
          <span className="dot">·</span>
          <span>{formatPublishedAt(item.published_at, item.region)}</span>
          <span className="dot">·</span>
          <span>{item.domain || 'no-domain'}</span>
          <span className="signal-theme-compact">{item.top5_theme}</span>

          <details className="signal-details signal-details-inline">
            <summary className="signal-details-toggle" aria-label="상세 보기">
              <span className="signal-details-icon" aria-hidden="true">⌄</span>
            </summary>

            <div className="signal-details-content">
              <div className="signal-breakdown-grid">
                {breakdown.map(([key, value]) => (
                  <div key={`${item.id}-${key}`} className="mini-meter">
                    <span className="mini-meter-label">{key}</span>
                    <div className="mini-meter-track">
                      <span style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="signal-detail-columns">
                <div>
                  <h4>요약</h4>
                  <ul>
                    {summaryLines.map((line, idx) => (
                      <li key={`${item.id}-summary-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>체크포인트</h4>
                  <ul>
                    {item.checkpoints?.slice(0, 5).map((point, idx) => (
                      <li key={`${item.id}-checkpoint-${idx}`}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {item.verification_note && <p className="signal-note">{item.verification_note}</p>}
            </div>
          </details>
        </div>
      </div>
    </article>
  );
};

export default NewsCard;

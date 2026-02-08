import React from 'react';
import { NewsItem } from '../types';

interface ConclusionSectionProps {
  takeaways: string[];
  items?: NewsItem[];
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function stripPrefix(text: string) {
  if (!text) return text;
  return text
    .replace(/^최상위 뉴스:\s*/i, '')
    .replace(/^두 번째 시그널:\s*/i, '')
    .replace(/^추가 모니터링:\s*/i, '')
    .trim();
}

const ConclusionSection: React.FC<ConclusionSectionProps> = ({ takeaways, items }) => {
  const rows = [0, 1, 2].map((idx) => {
    const item = items && items[idx];
    const fallback = stripPrefix(takeaways[idx] || '') || '내용 없음';
    const text = item ? item.title : fallback;
    const canLink = item && item.url && isValidUrl(item.url) && item.link_status !== 'broken';
    return { text, url: canLink ? item!.url : '' };
  });

  return (
    <section className="brief-summary-block">
      <div className="section-head">
        <h2 className="summary-headline">Executive Summary</h2>
      </div>

      <div className="summary-lines">
        {rows.map((row, idx) => (
          <div key={idx} className="summary-line-row">
            <span className="summary-index">{String(idx + 1).padStart(2, '0')}</span>
            {row.url ? (
              <a href={row.url} target="_blank" rel="noopener noreferrer" className="summary-line-text summary-line-link">
                {row.text}
              </a>
            ) : (
              <p className="summary-line-text">{row.text}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default ConclusionSection;

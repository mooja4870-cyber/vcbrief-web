import React from 'react';
import { NewsItem } from '../types';
import NewsCard from './NewsCard';

interface NewsGridProps {
  items: NewsItem[];
  quotaAddedIds?: Set<string>;
}

const NewsGrid: React.FC<NewsGridProps> = ({ items, quotaAddedIds }) => {
  return (
    <div className="signal-list">
      {items.map((item, index) => (
        <NewsCard
          key={item.id}
          item={item}
          rank={index + 1}
          quotaAdded={Boolean(quotaAddedIds && quotaAddedIds.has(item.id))}
        />
      ))}
    </div>
  );
};

export default NewsGrid;

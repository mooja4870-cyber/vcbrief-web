import React from 'react';
import { NewsItem } from '../types';
import NewsCard from './NewsCard';

interface NewsGridProps {
  items: NewsItem[];
}

const NewsGrid: React.FC<NewsGridProps> = ({ items }) => {
  return (
    <div className="signal-list">
      {items.map((item, index) => (
        <NewsCard key={item.id} item={item} rank={index + 1} />
      ))}
    </div>
  );
};

export default NewsGrid;

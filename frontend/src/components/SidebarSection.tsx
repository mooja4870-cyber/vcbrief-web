import React from 'react';

interface SidebarSectionProps {
  title: string;
  items: string[];
  type: 'summary' | 'checklist';
}

const SidebarSection: React.FC<SidebarSectionProps> = ({ title, items, type }) => {
  return (
    <section className="tool-section">
      <h3 className="tool-title">{title}</h3>
      {!items || items.length === 0 ? (
        <p className="tool-empty">특이사항 없음</p>
      ) : (
        <ul className="tool-list">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className={`tool-list-item ${type === 'checklist' ? 'tool-list-check' : ''}`}>
              {type === 'checklist' ? (
                <label className="tool-checkline">
                  <input type="checkbox" />
                  <span>{item}</span>
                </label>
              ) : (
                <span>{item}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SidebarSection;

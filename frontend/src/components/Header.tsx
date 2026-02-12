import React from 'react';
import ThemeToggle from './ThemeToggle';

const Header: React.FC = () => {
  return (
    <header className="terminal-header sticky top-0 z-50">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-1">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="brand-lockup">
            <h1 className="brand-title">VC Signal Brief</h1>
            <p className="brand-sub">Top Market Signals in 5 Minutes</p>
          </div>
          <div className="header-actions">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

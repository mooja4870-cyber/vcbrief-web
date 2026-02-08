import React from 'react';
import { useTheme } from '../ThemeContext';
import { ThemeVariant } from '../theme';

const THEME_VARIANTS: ThemeVariant[] = [1, 2, 3];
const THEME_VARIANT_LABELS: Record<ThemeVariant, string> = {
    1: 'Classic',
    2: 'Ocean',
    3: 'Amber'
};

const ThemeToggle: React.FC = () => {
    const { themeMode, themeVariant, toggleMode, setVariant } = useTheme();

    return (
        <div className="theme-toggle-wrap">
            <button
                type="button"
                onClick={toggleMode}
                className="theme-toggle-btn"
                aria-pressed={themeMode === 'light'}
                aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} themes`}
            >
                <span className="theme-toggle-icon">
                    {themeMode === 'dark' ? 'DARK' : 'LIGHT'}
                </span>
                <span className="theme-toggle-text">
                    {themeMode === 'dark' ? 'to Light' : 'to Dark'}
                </span>
            </button>

            <div className="theme-variant-group" role="group" aria-label={`${themeMode} theme variants`}>
                {THEME_VARIANTS.map((variant) => {
                    const isActive = variant === themeVariant;
                    const label = THEME_VARIANT_LABELS[variant];
                    return (
                        <button
                            key={variant}
                            type="button"
                            onClick={() => setVariant(variant)}
                            className={`theme-variant-btn${isActive ? ' theme-variant-btn-active' : ''}`}
                            aria-pressed={isActive}
                            aria-label={`${themeMode} ${label} theme`}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ThemeToggle;

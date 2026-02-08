import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
    applyTheme,
    getThemeMode,
    getThemeVariant,
    loadThemePreference,
    saveThemePreference,
    ThemeId,
    ThemeMode,
    ThemeVariant,
    toThemeId,
    toggleThemeMode
} from './theme';

interface ThemeContextType {
    themeId: ThemeId;
    themeMode: ThemeMode;
    themeVariant: ThemeVariant;
    setTheme: (themeId: ThemeId) => void;
    setVariant: (variant: ThemeVariant) => void;
    toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [themeId, setThemeId] = useState<ThemeId>(() => loadThemePreference());

    useEffect(() => {
        applyTheme(themeId);
        saveThemePreference(themeId);
    }, [themeId]);

    const themeMode = useMemo(() => getThemeMode(themeId), [themeId]);
    const themeVariant = useMemo(() => getThemeVariant(themeId), [themeId]);

    const handleSetTheme = (nextThemeId: ThemeId) => {
        setThemeId((currentThemeId) => currentThemeId === nextThemeId ? currentThemeId : nextThemeId);
    };

    const handleSetVariant = (variant: ThemeVariant) => {
        setThemeId((currentThemeId) => toThemeId(getThemeMode(currentThemeId), variant));
    };

    const handleToggleMode = () => {
        setThemeId((currentThemeId) => toggleThemeMode(currentThemeId));
    };

    return (
        <ThemeContext.Provider
            value={{
                themeId,
                themeMode,
                themeVariant,
                setTheme: handleSetTheme,
                setVariant: handleSetVariant,
                toggleMode: handleToggleMode
            }}
        >
            {children}
        </ThemeContext.Provider>
    );
};

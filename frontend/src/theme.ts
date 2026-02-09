export type ThemeMode = 'dark' | 'light';
export type ThemeVariant = 1 | 2 | 3;
export type ThemeId = 'dark-1' | 'dark-2' | 'dark-3' | 'light-1' | 'light-2' | 'light-3';

const THEME_STORAGE_KEY = 'theme-preference';
const DEFAULT_DARK_THEME: ThemeId = 'dark-1';
const DEFAULT_LIGHT_THEME: ThemeId = 'light-1';
const DEFAULT_THEME: ThemeId = DEFAULT_DARK_THEME;

const ALL_THEMES: ThemeId[] = ['dark-1', 'dark-2', 'dark-3', 'light-1', 'light-2', 'light-3'];

export const isThemeId = (value: unknown): value is ThemeId => {
    return typeof value === 'string' && ALL_THEMES.includes(value as ThemeId);
};

export const isThemeVariant = (value: unknown): value is ThemeVariant => {
    return value === 1 || value === 2 || value === 3;
};

export const getThemeMode = (themeId: ThemeId): ThemeMode => {
    return themeId.startsWith('dark') ? 'dark' : 'light';
};

export const getThemeVariant = (themeId: ThemeId): ThemeVariant => {
    const variant = Number(themeId.split('-')[1]);
    return isThemeVariant(variant) ? variant : 1;
};

export const toThemeId = (mode: ThemeMode, variant: ThemeVariant): ThemeId => {
    return `${mode}-${variant}` as ThemeId;
};

export const toggleThemeMode = (themeId: ThemeId): ThemeId => {
    const nextMode: ThemeMode = getThemeMode(themeId) === 'dark' ? 'light' : 'dark';
    return toThemeId(nextMode, getThemeVariant(themeId));
};

export const getSystemThemeMode = (): ThemeMode => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return 'dark';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getSystemThemePreference = (): ThemeId => {
    return getSystemThemeMode() === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
};

export const applyTheme = (themeId: ThemeId) => {
    if (typeof document === 'undefined') {
        return;
    }

    const root = document.documentElement;
    const mode = getThemeMode(themeId);
    const variant = getThemeVariant(themeId);

    root.setAttribute('data-theme', themeId);
    root.setAttribute('data-theme-mode', mode);
    root.setAttribute('data-theme-variant', String(variant));
    root.style.colorScheme = mode;

    // Helps mobile browsers render correct UI colors and reduces "forced dark" heuristics.
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) {
        themeColor.content = mode === 'dark' ? '#0b1220' : '#f8fafc';
    }
};

export const saveThemePreference = (themeId: ThemeId) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
        // Ignore storage failures (private mode, blocked storage, etc.).
    }
};

export const loadThemePreference = (): ThemeId => {
    if (typeof window === 'undefined') {
        return DEFAULT_THEME;
    }

    try {
        const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeId(storedTheme)) {
            return storedTheme;
        }
    } catch {
        // Fall back to system preference.
    }

    return getSystemThemePreference();
};

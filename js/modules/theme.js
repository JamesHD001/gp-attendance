const THEME_STORAGE_KEY = 'gpThemePreference';
const VALID_THEMES = new Set(['light', 'dark']);

export function getThemePreference() {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(storedTheme) ? storedTheme : 'light';
  } catch (_) {
    return 'light';
  }
}

export function applyTheme(theme = getThemePreference(), options = {}) {
  const nextTheme = VALID_THEMES.has(theme) ? theme : 'light';
  const { persist = true, animate = false } = options;

  if (animate) {
    document.documentElement.classList.add('theme-transition');
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transition');
    }, 350);
  }

  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', nextTheme === 'dark' ? '#0b1220' : '#0066cc');
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (_) {}
  }

  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: nextTheme } }));
  return nextTheme;
}

export function toggleTheme(options = {}) {
  const nextTheme = getThemePreference() === 'dark' ? 'light' : 'dark';
  return applyTheme(nextTheme, { animate: true, ...options });
}

export function initTheme() {
  return applyTheme(getThemePreference(), { persist: false });
}

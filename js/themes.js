const Themes = (() => {
  const STORAGE_KEY = 'theme';

  const presets = {
    auto: { name: 'Auto', vars: null }, // Uses system prefers-color-scheme
    midnight: {
      name: 'Midnight',
      vars: {
        '--bg': '#000000', '--text': '#ffffff', '--text-secondary': '#8e8e93',
        '--green': '#30d158', '--green-dark': '#0a3d1a', '--red': '#ff453a',
        '--red-dark': '#3d0f0c', '--btn-bg': '#1c1c1e', '--btn-border': '#38383a',
        '--separator': '#38383a', '--lap-best': '#30d158', '--lap-worst': '#ff453a',
      }
    },
    ocean: {
      name: 'Ocean',
      vars: {
        '--bg': '#0a1628', '--text': '#e0e8f0', '--text-secondary': '#7a8da6',
        '--green': '#0ac7e8', '--green-dark': '#0a2838', '--red': '#ff6b6b',
        '--red-dark': '#3d1a1a', '--btn-bg': '#132240', '--btn-border': '#1e3a5f',
        '--separator': '#1e3a5f', '--lap-best': '#0ac7e8', '--lap-worst': '#ff6b6b',
      }
    },
    sunset: {
      name: 'Sunset',
      vars: {
        '--bg': '#1a0f0a', '--text': '#f5e6d3', '--text-secondary': '#b39880',
        '--green': '#f5a623', '--green-dark': '#3d2a0c', '--red': '#e85d4a',
        '--red-dark': '#3d1510', '--btn-bg': '#2a1a10', '--btn-border': '#4a3020',
        '--separator': '#4a3020', '--lap-best': '#f5a623', '--lap-worst': '#e85d4a',
      }
    },
    minimal: {
      name: 'Minimal',
      vars: {
        '--bg': '#ffffff', '--text': '#1a1a1a', '--text-secondary': '#8e8e93',
        '--green': '#007aff', '--green-dark': '#e0ecff', '--red': '#ff3b30',
        '--red-dark': '#ffe0de', '--btn-bg': '#f0f0f5', '--btn-border': '#d1d1d6',
        '--separator': '#d1d1d6', '--lap-best': '#007aff', '--lap-worst': '#ff3b30',
      }
    },
    oled: {
      name: 'OLED',
      vars: {
        '--bg': '#000000', '--text': '#ffffff', '--text-secondary': '#555555',
        '--green': '#00ff88', '--green-dark': '#001a0d', '--red': '#ff0044',
        '--red-dark': '#1a0008', '--btn-bg': '#0a0a0a', '--btn-border': '#222222',
        '--separator': '#222222', '--lap-best': '#00ff88', '--lap-worst': '#ff0044',
      }
    },
  };

  function getThemeId() {
    return localStorage.getItem(STORAGE_KEY) || 'auto';
  }

  function apply(themeId) {
    const theme = presets[themeId];
    if (!theme) return;

    localStorage.setItem(STORAGE_KEY, themeId);
    const root = document.documentElement;

    if (themeId === 'auto') {
      // Remove inline styles to let CSS media queries work
      Object.keys(presets.midnight.vars).forEach(v => root.style.removeProperty(v));
    } else {
      Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    }

    // Update theme-color meta tag
    const bg = theme.vars ? theme.vars['--bg'] : null;
    if (bg) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = bg;
    }
  }

  function init() {
    apply(getThemeId());
  }

  function getPresets() {
    return Object.entries(presets).map(([id, p]) => ({ id, name: p.name }));
  }

  return { init, apply, getThemeId, getPresets };
})();

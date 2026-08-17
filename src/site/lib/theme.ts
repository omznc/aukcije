/**
 * Which of the two sheets a visitor reads on.
 *
 * There are three states, not two: paper, dark, and "whatever the system says",
 * which is where everyone starts. The third is not a value that gets written
 * down - it is the absence of one, so a visitor who has never pressed the
 * toggle keeps following their machine as it turns dark in the evening and back
 * in the morning.
 *
 * The palette itself is CSS and only CSS: `global.css` declares every colour
 * through `light-dark()`, so applying a theme here is one property on the root
 * element and nothing else. Setting it as an inline style is deliberate - it is
 * how an explicit choice outranks the `color-scheme: light dark` the stylesheet
 * leaves behind for the system to resolve.
 *
 * The same resolution runs twice: once here, and once in the small inline
 * script in the head of `Base.astro`, which cannot import this because it has to
 * run before the first paint rather than after the module graph has loaded.
 * That copy is the one that prevents a white flash on a dark sheet; this one is
 * what the toggle uses afterwards. The storage key is shared rather than
 * spelled out twice, for the same reason as in `saved.ts`.
 */

export const THEME_KEY = 'prikaz:tema';

export type Theme = 'light' | 'dark';

/** The stored choice, or null when there is none and the system decides. */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Storage can be blocked outright; the sheet then follows the system every
    // time, which is the same thing a first visit does.
    return null;
  }
}

/** What the machine asks for, which is what an unset choice resolves to. */
export function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Paint the sheet. `null` hands the decision back to the system by removing the
 * override rather than by writing the current system value in its place, so the
 * page keeps tracking it afterwards.
 */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  root.style.colorScheme = theme ?? '';
  // What everything other than the colours keys off: the toggle's own label,
  // and anything that needs to know which sheet it landed on without having to
  // resolve the choice a third time.
  root.dataset.theme = theme ?? systemTheme();
}

/**
 * The header's toggle. It flips between the two sheets rather than cycling
 * through all three states: "follow the system" is a good default but a poor
 * step to have to pass through, and the only way back to it is to clear the
 * site's storage - which is exactly what /privatnost/ says clears everything
 * else here too.
 */
export function wireThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!button) return;

  const reflect = (theme: Theme) => {
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  };

  button.addEventListener('click', () => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The press still lands, it just will not survive the next page.
    }
    applyTheme(next);
    reflect(next);
  });

  // Until a choice is made this page belongs to the system, so it should turn
  // with it rather than wait for a reload.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (storedTheme()) return;
    applyTheme(null);
    reflect(systemTheme());
  });

  // Choosing in one tab should show up in the others, exactly as saving does.
  addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== THEME_KEY) return;
    const stored = storedTheme();
    applyTheme(stored);
    reflect(stored ?? systemTheme());
  });
}

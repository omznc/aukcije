import { savedCount } from './saved.ts';

/**
 * Show how many things are saved, wherever the layout asks for it.
 *
 * The header is rendered at build time and the count only exists in the visitor's
 * browser, so it starts empty and is filled in here - on load, and again the
 * moment a save button changes it.
 */
export function refreshSavedCount(): void {
  const total = savedCount();
  for (const el of document.querySelectorAll<HTMLElement>('[data-saved-count]')) {
    const firstFill = el.dataset.filled === undefined;
    const changed = el.textContent !== String(total);
    const wasHidden = el.hidden;

    el.textContent = String(total);
    el.hidden = total === 0;
    el.dataset.filled = '';

    // On load the header is only catching up with what the browser already
    // knew, so it fills in silently. Animating here would replay on every
    // navigation, and navigating is most of what anyone does on this site.
    if (firstFill || el.hidden) continue;

    // The button that was just pressed is usually far from the header, so the
    // counter moving is the only sign the press did anything. Arriving from
    // nothing and changing by one are different events, and read differently.
    if (wasHidden) restart(el, 'enter');
    else if (changed) restart(el, 'bump');
  }
}

/**
 * Re-running an animation needs the attribute gone for a frame first, which is
 * what reading `offsetWidth` forces. Both are cleared either way, so a badge
 * that appears and then changes does not carry the entrance into the bump.
 */
function restart(el: HTMLElement, kind: 'enter' | 'bump'): void {
  delete el.dataset.enter;
  delete el.dataset.bump;
  void el.offsetWidth;
  el.dataset[kind] = '';
}

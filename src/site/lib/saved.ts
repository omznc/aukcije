/**
 * Where a visitor's saved notices and followed categories live: their own
 * localStorage, one key per item, holding the moment it was saved.
 *
 * There is no account and no cookie behind this, and nothing is ever sent
 * anywhere - which is also why the key prefixes have to be shared rather than
 * spelled out at each call site. The button that writes a key (SaveToggle), the
 * header that counts them (Base) and the page that lists them (/sacuvano/) are
 * three different files, and a typo in any one of them would silently lose
 * someone's list.
 */

export const AD_PREFIX = 'sacuvano:oglas:';
export const TAG_PREFIX = 'prati:predmet:';

/** The ids saved under a prefix. Empty when storage is blocked outright. */
export function savedKeys(prefix: string): string[] {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  } catch {
    return [];
  }
}

export function savedCount(): number {
  return savedKeys(AD_PREFIX).length + savedKeys(TAG_PREFIX).length;
}

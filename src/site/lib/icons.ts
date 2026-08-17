import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Phosphor duotone icons, inlined at build time.
 *
 * The assets ship as plain SVG files, so there is no icon integration and no
 * runtime JavaScript: `Icon.astro` pastes the paths straight into the page and
 * they inherit `currentColor` like any other glyph. Duotone draws the same shape
 * twice, the backdrop at `opacity: 0.2`, which is why an icon reads as a tint
 * plus an outline rather than a solid block against this paper palette.
 */

const require = createRequire(import.meta.url);
const cache = new Map<string, string>();

/** The contents of an icon's `<svg>`, ready to inline. Throws on a typo'd name. */
export function iconBody(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;

  let file: string;
  try {
    file = require.resolve(`@phosphor-icons/core/assets/duotone/${name}-duotone.svg`);
  } catch {
    // A missing icon renders as nothing at all, which no build check would catch,
    // so it has to stop the build instead.
    throw new Error(`Unknown Phosphor icon "${name}" (looked for ${name}-duotone.svg)`);
  }

  const body = readFileSync(file, 'utf8')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  cache.set(name, body);
  return body;
}

/**
 * The court's own five categories. These are the coarse buckets the portal
 * publishes, so the icons stay equally coarse.
 */
export const SALE_TYPE_ICONS: Record<string, string> = {
  nekretnine: 'house-line',
  vozila: 'car',
  tehnika: 'gear',
  namjestaj: 'armchair',
  ostalo: 'package',
};

/** Keyed by the group names in `src/extract/items.ts`. */
export const TAG_GROUP_ICONS: Record<string, string> = {
  'Računari i IT oprema': 'desktop-tower',
  'Kućanski aparati': 'washing-machine',
  Namještaj: 'armchair',
  Vozila: 'car',
  'Mašine i alati': 'wrench',
  Poljoprivreda: 'tractor',
  'Ugostiteljstvo i trgovina': 'storefront',
  Nekretnine: 'house-line',
  Ostalo: 'package',
};

/** Fallbacks keep a new category from shipping without an icon. */
export const saleTypeIcon = (key: string) => SALE_TYPE_ICONS[key] ?? 'package';
export const tagGroupIcon = (group: string) => TAG_GROUP_ICONS[group] ?? 'package';

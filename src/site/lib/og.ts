import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { Listing } from '../../schema.ts';
import { PATHS } from '../../config.ts';
import { SALE_TYPE_LABELS, formatDate, formatMoney } from './data.ts';
import { headline } from './headline.ts';
import { discount, formatPercent, daysLabel } from './stats.ts';
import { daysUntil } from './dates.ts';

/**
 * The card a listing turns into when someone pastes its link somewhere.
 *
 * These notices circulate by being sent to people - a link in a Viber group is
 * how most of them travel - so for a lot of readers this image *is* the page.
 * It carries the three things that decide whether the link is worth opening:
 * what is being sold, what it starts at, and how long is left.
 *
 * Rendered with satori (JSX-shaped objects → SVG) and resvg (SVG → PNG), both
 * at build time, so nothing here runs on a request. The fonts are the site's
 * own, checked in beside this file, because a build that reached out to Google
 * Fonts would be a build that fails when Google Fonts is slow.
 *
 * Caching: a card takes ~130 ms and there is one per notice, so redrawing the
 * whole archive costs six minutes of every twice-daily build. Each card is
 * therefore keyed by the exact values printed on it (`CardModel`) and kept in
 * `.cache/og`. Settled listings hash to the same key forever; the few dozen
 * upcoming ones re-render each day, because their countdown is part of what is
 * drawn and so part of the key.
 */

/** Bump to invalidate every cached card after a design change. */
const CARD_VERSION = 1;

/**
 * Read from the project root rather than relative to this module: Astro bundles
 * this file into dist/.prerender before running it, so `import.meta.url` points
 * at a chunk sitting nowhere near the fonts. The build always runs from the
 * root, and if it ever does not, this should stop rather than silently render
 * every card in a fallback face.
 */
const FONT_DIR = join(process.cwd(), 'src/site/assets/fonts');

function font(name: string): Buffer {
  try {
    return readFileSync(join(FONT_DIR, name));
  } catch {
    throw new Error(
      `Share-card font missing: ${join(FONT_DIR, name)}. Run the build from the project root.`,
    );
  }
}

const FONTS = [
  { name: 'Instrument Serif', data: font('instrument-serif-400.ttf'), weight: 400 as const, style: 'normal' as const },
  { name: 'Instrument Sans', data: font('instrument-sans-600.ttf'), weight: 600 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: font('jetbrains-mono-400.ttf'), weight: 400 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: font('jetbrains-mono-700.ttf'), weight: 700 as const, style: 'normal' as const },
];

const C = {
  sheet: '#f7f5f0',
  band: '#f1eee7',
  rule: '#dcd8cf',
  ink: '#16181a',
  muted: '#55585c',
  dim: '#7c7a74',
  pine: '#0a5c46',
  brick: '#a02010',
  white: '#ffffff',
};

export const OG_SIZE = { width: 1200, height: 630 };

/** Satori has no text-overflow, so long strings are cut before layout. */
const clip = (s: string, limit: number) =>
  s.length <= limit ? s : `${s.slice(0, limit - 1).trimEnd()}…`;

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

const label = (text: string, color = C.dim) =>
  el(
    'div',
    {
      fontFamily: 'JetBrains Mono',
      fontSize: 20,
      letterSpacing: '0.08em',
      color,
      textTransform: 'uppercase',
    },
    text,
  );

function figure(caption: string, value: string, options: { big?: boolean; color?: string } = {}) {
  return el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
    label(caption),
    el(
      'div',
      {
        fontFamily: 'JetBrains Mono',
        fontWeight: options.big ? 700 : 400,
        fontSize: options.big ? 56 : 38,
        letterSpacing: '-0.008em',
        color: options.color ?? C.ink,
      },
      value,
    ),
  ]);
}

/**
 * Everything the card prints, and nothing else.
 *
 * The cache key is a hash of this object, so it has to be exactly the drawn
 * values - not the listing. Derive a new string here and forget to put it in
 * the model, and stale cards would survive a change that should have redrawn
 * them; that is why `card()` below reads only from this and never from the
 * listing.
 */
interface CardModel {
  v: number;
  kind: string;
  entity: string;
  headline: string;
  where: string;
  price: string;
  secondCaption: string;
  secondValue: string;
  secondColor: string;
  countdownCaption: string;
  countdownValue: string;
  countdownColor: string;
  footer: string;
}

function model(l: Listing): CardModel {
  const days = daysUntil(l.saleDate);
  const off = discount(l);
  const past = days < 0;
  const discounted = off !== null && off > 0;

  return {
    v: CARD_VERSION,
    kind: SALE_TYPE_LABELS[l.saleType],
    entity: l.entity,
    headline: clip(headline(l), 96),
    where: clip(`${l.court}${l.location?.municipality ? ` · ${l.location.municipality}` : ''}`, 70),
    price: formatMoney(l.startingPrice) ?? 'nije navedena',
    secondCaption: discounted ? 'Ispod procjene' : 'Procijenjeno',
    secondValue: discounted ? formatPercent(off) : (formatMoney(l.appraisedValue) ?? '-'),
    secondColor: discounted ? C.pine : C.ink,
    countdownCaption: past ? 'Ročište je prošlo' : 'Do ročišta',
    countdownValue: past ? formatDate(l.saleDate) : daysLabel(days),
    countdownColor: past ? C.dim : days <= 7 ? C.brick : C.ink,
    footer: `ROČIŠTE ${formatDate(l.saleDate)}${l.saleTime ? ` U ${l.saleTime}` : ''}`,
  };
}

/**
 * The ink spine down the left edge, which is what makes a card pasted into a
 * chat read as this site. Drawn as an element rather than a border: satori
 * renders a `borderLeft` on the root inconsistently, and a missing one is only
 * visible once the image is already out in the world.
 */
const spine = () =>
  el('div', {
    width: 14,
    height: OG_SIZE.height,
    // Without this it shrinks to nothing: the content column beside it is wider
    // than the card, and a flex item shrinks by default.
    flexShrink: 0,
    backgroundColor: C.ink,
  });

/** The frame both cards share: spine, then everything else. */
const frame = (children: unknown) =>
  el(
    'div',
    {
      width: OG_SIZE.width,
      height: OG_SIZE.height,
      display: 'flex',
      backgroundColor: C.sheet,
      fontFamily: 'Instrument Sans',
    },
    [spine(), children],
  );

function card(m: CardModel): Node {
  return frame(
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        width: OG_SIZE.width - 14,
        height: OG_SIZE.height,
      },
      [
      el(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '30px 48px',
          backgroundColor: C.band,
          borderBottom: `2px solid ${C.rule}`,
        },
        [
          el(
            'div',
            { fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 24, letterSpacing: '-0.01em', color: C.ink },
            'SUDSKE PRODAJE',
          ),
          label(`${m.kind} · ${m.entity}`),
        ],
      ),

      el(
        'div',
        { display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '38px 48px 0 48px' },
        [
          el(
            'div',
            {
              fontFamily: 'Instrument Serif',
              fontSize: 62,
              lineHeight: 1.06,
              letterSpacing: '-0.022em',
              color: C.ink,
            },
            m.headline,
          ),
          el('div', { fontSize: 26, color: C.muted, marginTop: 20 }, m.where),
        ],
      ),

      el(
        'div',
        {
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          padding: '0 48px 34px 48px',
        },
        [
          figure('Početna cijena', m.price, { big: true }),
          figure(m.secondCaption, m.secondValue, { color: m.secondColor }),
          figure(m.countdownCaption, m.countdownValue, { color: m.countdownColor }),
        ],
      ),

      el(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '18px 48px',
          backgroundColor: C.ink,
        },
        [
          el(
            'div',
            { fontFamily: 'JetBrains Mono', fontSize: 20, letterSpacing: '0.06em', color: C.white },
            m.footer,
          ),
          el(
            'div',
            { fontFamily: 'JetBrains Mono', fontSize: 20, letterSpacing: '0.06em', color: '#b3b0a7' },
            'SUDSKEPRODAJE.OMARZUNIC.COM',
          ),
        ],
      ),
      ],
    ),
  );
}

async function render(node: Node): Promise<Buffer> {
  const svg = await satori(node as never, { ...OG_SIZE, fonts: FONTS });
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: OG_SIZE.width } }).render().asPng(),
  );
}

let cacheReady = false;

/**
 * A rendered card, from `.cache/og` when what it would draw has not changed.
 *
 * The cache is a build accelerator, never a correctness dependency: a missing,
 * unreadable or unwritable directory costs time and nothing else, so every
 * failure here falls through to rendering rather than stopping the build.
 */
async function cached(id: string, key: string, draw: () => Promise<Buffer>): Promise<Buffer> {
  const png = join(PATHS.cards, `${id}.png`);
  // One image and one key per listing, overwritten rather than added to. An
  // upcoming listing's countdown changes daily, so a key-in-the-filename scheme
  // would leave a fresh orphan behind every single build.
  const stamp = join(PATHS.cards, `${id}.key`);

  try {
    if (readFileSync(stamp, 'utf8') === key) return readFileSync(png);
  } catch {
    // Absent or unreadable: draw it.
  }

  const image = await draw();
  try {
    if (!cacheReady) {
      mkdirSync(PATHS.cards, { recursive: true });
      cacheReady = true;
    }
    writeFileSync(png, image);
    // Key last: a crash between the two leaves a stale image with no key, which
    // is a miss on the next run rather than a wrong card served forever.
    writeFileSync(stamp, key);
  } catch {
    // A read-only or full disk is not a reason to fail a build.
  }
  return image;
}

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

export function listingCard(l: Listing): Promise<Buffer> {
  const m = model(l);
  return cached(l.id, hash(m), () => render(card(m)));
}

/**
 * The fallback card, for every page that is not one listing. Deliberately plain:
 * it stands in for the site, not for a lot.
 */
export function defaultCard(counts: {
  listings: number;
  courts: number;
  upcoming: number;
}): Promise<Buffer> {
  const summary = `${counts.upcoming} otvorenih licitacija, ${counts.listings.toLocaleString(
    'bs-BA',
  )} oglasa iz ${counts.courts} sudova, sa arhivom cijena i otvorenim podacima.`;

  return cached('default', hash([CARD_VERSION, summary]), () =>
    render(
      frame(
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            width: OG_SIZE.width - 14,
            height: OG_SIZE.height,
            justifyContent: 'center',
            padding: '0 64px',
          },
          [
          label('Nezavisni indeks · nije službeni izvor'),
          el(
            'div',
            {
              fontFamily: 'Instrument Serif',
              fontSize: 82,
              lineHeight: 1.04,
              letterSpacing: '-0.032em',
              color: C.ink,
              marginTop: 24,
            },
            'Šta sudovi u BiH prodaju.',
          ),
          el('div', { fontSize: 30, color: C.muted, marginTop: 26, maxWidth: 900 }, summary),
          el(
            'div',
            {
              fontFamily: 'JetBrains Mono',
              fontSize: 22,
              letterSpacing: '0.06em',
              color: C.dim,
              marginTop: 40,
            },
            'SUDSKEPRODAJE.OMARZUNIC.COM',
          ),
          ],
        ),
      ),
    ),
  );
}

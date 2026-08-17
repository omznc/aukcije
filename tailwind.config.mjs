export default {
  content: ['./src/site/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Instrument Sans'", 'system-ui', 'sans-serif'],
        serif: ["'Instrument Serif'", 'Georgia', 'serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
      // Tracking is a function of size, not one value for the site: letters set
      // large read too far apart at the spacing that suits body copy, and small
      // uppercase reads too tight at it. Each step is named for where it goes,
      // so the same headline is spaced the same way on every page.
      letterSpacing: {
        display: '-0.032em', // the largest serif headline, 38px and up
        title: '-0.022em', // page headlines, 28-34px
        head: '-0.012em', // section headings, 19-24px
        num: '-0.008em', // large mono figures, which set wide by nature
        label: '0.06em', // uppercase meta lines
        caps: '0.08em', // the smallest uppercase headings, which need the most
      },
      // Leading tightens as type grows, for the same reason.
      lineHeight: {
        display: '1.04',
        title: '1.06',
        head: '1.2',
      },
      // Every colour is a name pointing at a custom property, and the values
      // themselves live in `src/site/styles/global.css` - once for paper, once
      // for the dark sheet. Nothing here is a hex, so no rule in the codebase
      // has to know which of the two it is being drawn in.
      //
      // The consequence to remember: Tailwind's slash opacity (`bg-pine/40`)
      // cannot rewrite a `var()`, so a tint that used to be written that way is
      // its own token instead - see `pine-soft`.
      colors: {
        // Paper stack: outer surround, the sheet the site sits on, the tinted
        // bands that separate sections within it, and the blank field that
        // tables of rows are drawn on.
        paper: 'var(--c-paper)',
        sheet: 'var(--c-sheet)',
        band: 'var(--c-band)',
        blank: 'var(--c-blank)',
        // What a surface does under the cursor and under the finger. `wash` is
        // for anything sitting on the blank field, `band-wash` for the strips
        // that are already tinted.
        wash: 'var(--c-wash)',
        'wash-deep': 'var(--c-wash-deep)',
        'band-wash': 'var(--c-band-wash)',
        'band-wash-deep': 'var(--c-band-wash-deep)',
        // Rules: section borders, row hairlines, and control outlines.
        rule: 'var(--c-rule)',
        hair: 'var(--c-hair)',
        edge: 'var(--c-edge)',
        // Text, strongest to faintest, plus the one that goes on top of `ink`
        // itself - white on paper, near-black in the dark, never either by name.
        ink: 'var(--c-ink)',
        'ink-soft': 'var(--c-ink-soft)',
        'ink-mid': 'var(--c-ink-mid)',
        'ink-body': 'var(--c-ink-body)',
        muted: 'var(--c-muted)',
        dim: 'var(--c-dim)',
        faint: 'var(--c-faint)',
        ghost: 'var(--c-ghost)',
        'on-ink': 'var(--c-on-ink)',
        // Accents. Pine marks anything live or favourable, rust and brick mark
        // deadlines getting close.
        pine: 'var(--c-pine)',
        'pine-soft': 'var(--c-pine-soft)',
        rust: 'var(--c-rust)',
        brick: 'var(--c-brick)',
        // Chart fills and bar tracks. Moss and sage are the two middle steps of
        // the stacked bar on a court's page, between ink and rule.
        bar: 'var(--c-bar)',
        'bar-soft': 'var(--c-bar-soft)',
        track: 'var(--c-track)',
        mark: 'var(--c-mark)',
        moss: 'var(--c-moss)',
        sage: 'var(--c-sage)',
        // The map: land, coastline, and the two dot states.
        land: 'var(--c-land)',
        coast: 'var(--c-coast)',
        // Notice boxes.
        'warn-bg': 'var(--c-warn-bg)',
        'warn-edge': 'var(--c-warn-edge)',
        'due-bg': 'var(--c-due-bg)',
      },
    },
  },
};

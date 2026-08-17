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
      colors: {
        // Paper stack: outer surround, the sheet the site sits on, and the
        // tinted bands that separate sections within it.
        paper: '#e9e5dd',
        sheet: '#f7f5f0',
        band: '#f1eee7',
        // Rules: section borders, row hairlines, and control outlines.
        rule: '#dcd8cf',
        hair: '#ece8e0',
        edge: '#c9c4b8',
        // Text, darkest to lightest.
        ink: '#16181a',
        'ink-soft': '#2b2d30',
        'ink-mid': '#3d3f42',
        'ink-body': '#4a4d50',
        muted: '#55585c',
        dim: '#7c7a74',
        faint: '#9b988f',
        ghost: '#b3b0a7',
        // Accents. Pine marks anything live or favourable, rust and brick mark
        // deadlines getting close.
        pine: '#0a5c46',
        rust: '#a06010',
        brick: '#a02010',
        // Chart fills and bar tracks.
        bar: '#bdb8ab',
        'bar-soft': '#cfcabd',
        track: '#e4e0d6',
        mark: '#dce9a8',
        // Notice boxes.
        'warn-bg': '#f3ede2',
        'warn-edge': '#ddd0b8',
        'due-bg': '#f3ded6',
      },
    },
  },
};

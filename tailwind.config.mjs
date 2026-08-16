export default {
  content: ['./src/site/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Instrument Sans'", 'system-ui', 'sans-serif'],
        serif: ["'Instrument Serif'", 'Georgia', 'serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
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

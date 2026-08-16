/**
 * Tailwind is wired through PostCSS rather than through `@astrojs/tailwind`.
 *
 * That integration is capped at Astro 5 by its own peer range and is no longer
 * maintained, so on Astro 7 a clean `npm ci` refuses to resolve the tree at all
 * — it installs only with legacy peer resolution, which is a trap: it works on
 * a developer machine that already has node_modules and fails in CI.
 *
 * Astro picks this file up on its own. Nothing else is needed.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

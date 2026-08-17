import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: 'src/site',
  publicDir: 'public',
  outDir: 'dist',
  // Baked into canonical tags, RSS, the sitemap and llms.txt at build time.
  // Override with SITE_URL to build for a different host.
  // `||`, not `??`: CI passes an unset repository variable through as an empty
  // string, which would otherwise be accepted as the site URL.
  site: process.env.SITE_URL || 'https://sudskeprodaje.omarzunic.com',
  // Tailwind is configured through postcss.config.mjs, which Astro reads on its
  // own - see that file for why the integration is not used.
  build: { format: 'directory' },
});

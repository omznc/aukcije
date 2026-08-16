import { writeFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import { API_BASE, LANGS, PAGE_SIZE } from '../src/config.ts';
import { getJson, qs } from '../src/lib/http.ts';
import { discoverSaleCategories, fetchCategoryArticles } from '../src/sources/categories.ts';
import { fetchInstitution, entityOf } from '../src/sources/courts.ts';

/**
 * Enumerate every institution on the portal and establish, empirically, which
 * ones publish sale notices and through which route.
 *
 * This exists because coverage was previously guesswork: the central sales feed
 * silently omits courts that file sales as ordinary news (Općinski sud u
 * Sarajevo among them), and a missing court is invisible — nothing in the
 * output says "a whole court is absent". Published court counts and inferred
 * institution ids are not trustworthy enough to hardcode, so this asks the API
 * directly and writes the answer to data/coverage.json.
 *
 *   npm run discover           # scan the default id range
 *   npm run discover -- --max=250
 */
const MAX_ID = Number(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] ?? 200);

type Route = 'central-feed' | 'news-category' | 'none';

interface Coverage {
  id: number;
  name: string;
  entity: string;
  /** Notices reachable through the country-wide sudske-prodaje feed. */
  centralCount: number;
  /** Notices reachable through this court's own sale categories. */
  categoryCount: number;
  categories: Array<{ id: number; name: string; total: number }>;
  route: Route;
}

async function centralCountFor(insId: number): Promise<number> {
  try {
    const rows = await getJson<Array<{ total: number }>>(
      `${API_BASE}/sudske-prodaje?${qs({ page: 0, pageSize: 1, insId })}`,
    );
    return rows[0]?.total ?? 0;
  } catch {
    return 0;
  }
}

async function categoryCountFor(insId: number): Promise<Coverage['categories']> {
  try {
    const cats = await discoverSaleCategories(insId);
    const out: Coverage['categories'] = [];
    for (const cat of cats) {
      // One small page is enough to learn the total.
      const articles = await fetchCategoryArticles(cat, 1);
      out.push({
        id: cat.subcategoryId,
        name: cat.subcategoryName ?? cat.categoryName,
        total: articles.length ? Number.POSITIVE_INFINITY : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** The category endpoint reports a real total; fetch it precisely. */
async function categoryTotal(insId: number, categoryId: number): Promise<number> {
  try {
    const res = await getJson<{ total: number }>(
      `${API_BASE}/news-categories//news?${qs({
        insId,
        categoryId,
        rowStart: 1,
        rowEnd: 1,
        lang: LANGS.bs,
      })}`,
    );
    return res.total ?? 0;
  } catch {
    return 0;
  }
}

console.log(`Scanning institution ids 1–${MAX_ID}…\n`);

const limit = pLimit(3);
const found: Coverage[] = [];
let scanned = 0;

await Promise.all(
  Array.from({ length: MAX_ID }, (_, i) => i + 1).map((id) =>
    limit(async () => {
      const inst = await fetchInstitution(id);
      if (++scanned % 25 === 0) console.log(`  ${scanned}/${MAX_ID}`);
      if (!inst?.naziv) return;

      const name = inst.naziv.replace(/\s+/g, ' ').trim();
      // Prosecutor offices and administrative bodies do not hold execution sales.
      const isCourt = /\bsud\b|\bsuda\b|sudu\b/i.test(name);

      const centralCount = await centralCountFor(id);
      const cats = await discoverSaleCategories(id).catch(() => []);
      const categories: Coverage['categories'] = [];
      for (const cat of cats) {
        const total = await categoryTotal(id, cat.subcategoryId);
        if (total > 0) {
          categories.push({
            id: cat.subcategoryId,
            name: cat.subcategoryName ?? cat.categoryName,
            total,
          });
        }
      }
      const categoryCount = categories.reduce((n, c) => n + c.total, 0);
      if (centralCount === 0 && categoryCount === 0) return;

      found.push({
        id,
        name,
        entity: entityOf(name),
        centralCount,
        categoryCount,
        categories,
        route: centralCount > 0 ? 'central-feed' : categoryCount > 0 ? 'news-category' : 'none',
        ...(isCourt ? {} : { nonCourt: true }),
      } as Coverage);
    }),
  ),
);

found.sort((a, b) => a.id - b.id);

const viaCentral = found.filter((f) => f.route === 'central-feed');
const viaCategory = found.filter((f) => f.route === 'news-category');

console.log('\n── Institutions publishing sale notices ──────────────────');
for (const f of found) {
  const marker = f.route === 'news-category' ? '  ← MISSED by central feed' : '';
  console.log(
    `  ${String(f.id).padStart(4)}  ${f.entity.padEnd(5)} ${f.name.slice(0, 44).padEnd(45)}` +
      `central=${String(f.centralCount).padStart(4)} category=${String(f.categoryCount).padStart(5)}${marker}`,
  );
}

console.log(`\n  total publishing:      ${found.length}`);
console.log(`  via central feed:      ${viaCentral.length}`);
console.log(`  only via categories:   ${viaCategory.length}`);
console.log(`\n  FALLBACK_COURTS = [${viaCategory.map((f) => f.id).join(', ')}];`);

await writeFile(
  'data/coverage.json',
  `${JSON.stringify({ generatedAt: new Date().toISOString(), scannedTo: MAX_ID, institutions: found }, null, 2)}\n`,
  'utf8',
);
console.log('\n  written to data/coverage.json');

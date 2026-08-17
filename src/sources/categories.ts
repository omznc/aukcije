import { API_BASE, LANGS, WEB_BASE } from '../config.ts';
import { getJson, getText, qs } from '../lib/http.ts';
import { fold } from '../lib/text.ts';
import type { Attachment } from './article.ts';

/**
 * Fallback source for courts missing from the central sales feed.
 *
 * Those courts publish sale notices as ordinary news under an "Oglasna ploča →
 * Sudska prodaja" category. Two things make this workable:
 *
 *  - Category pages are server-rendered, so `__NEXT_DATA__` gives us the court's
 *    whole navigation tree without executing any JavaScript.
 *  - Paging goes through `/news-categories//news` (the empty path segment is
 *    genuine - the frontend interpolates an always-blank value there) using
 *    1-indexed, inclusive `rowStart`/`rowEnd`. It happily serves 100 rows at a
 *    time and returns attachments inline, so no per-article fetch is needed.
 */

export interface NewsCategoryArticle {
  id: number;
  header: string;
  subheader: string | null;
  date: string;
  description: string | null;
  content: string | null;
  url: string | null;
  tooltip: string | null;
  details: { dokumenti?: Attachment[] } | null;
}

interface NewsCategoryResponse {
  articles: NewsCategoryArticle[];
  total: number;
}

export interface SaleCategory {
  insId: number;
  moduleId: number;
  categoryId: number;
  categoryName: string;
  /** The leaf we actually query. Equals categoryId when there are no children. */
  subcategoryId: number;
  subcategoryName: string | null;
}

// Matched against transliterated, diacritic-folded text: RS courts return
// Cyrillic category names ("Судска продаја") even under the /B/ path when no
// Bosnian translation exists.
// Precision matters more than recall: a category like "Izvršno odjeljenje" or
// "Obavijest građanima o izvršnom postupku" is about enforcement generally, not
// about sales, and including it would file general court notices as auctions.
const SALE_CATEGORY_NEEDLES = ['prodaj', 'licitacij', 'nadmetanj', 'drazb'];

function isSaleCategory(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = fold(name);
  return SALE_CATEGORY_NEEDLES.some((needle) => n.includes(needle));
}

interface NavCategory {
  categoryId: number;
  categoryName: string;
  subcategories?: Array<{ id?: number; subcategoryId?: number; name: string }> | null;
}
interface NavModule {
  moduleId: number;
  moduleName: string;
  categories?: NavCategory[] | null;
}

function extractNextData(html: string): any {
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found - portal markup changed');
  return JSON.parse(m[1]);
}

/**
 * Discover which categories on a court's site hold sale notices, by reading the
 * server-rendered navigation tree from its landing page.
 */
export async function discoverSaleCategories(insId: number): Promise<SaleCategory[]> {
  const html = await getText(`${WEB_BASE}/${LANGS.bs}/${insId}`);
  const nav: NavModule[] = extractNextData(html)?.props?.pageProps?.navigationItems ?? [];
  const found: SaleCategory[] = [];

  for (const mod of nav) {
    for (const cat of mod.categories ?? []) {
      const subs = cat.subcategories ?? [];
      const catMatches = isSaleCategory(cat.categoryName);
      const matchingSubs = subs.filter((s) => isSaleCategory(s.name));

      // A category named "Sudska prodaja" makes all its children relevant;
      // otherwise only the children that name themselves as sales.
      const targets = catMatches ? (subs.length ? subs : []) : matchingSubs;

      if (catMatches && subs.length === 0) {
        found.push({
          insId,
          moduleId: mod.moduleId,
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          subcategoryId: cat.categoryId,
          subcategoryName: null,
        });
      }
      for (const sub of targets) {
        const id = sub.id ?? sub.subcategoryId;
        if (id === undefined) continue;
        found.push({
          insId,
          moduleId: mod.moduleId,
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          subcategoryId: id,
          subcategoryName: sub.name,
        });
      }
    }
  }
  return found;
}

/** Page through one category. `limit` caps how far back we walk. */
export async function fetchCategoryArticles(
  cat: SaleCategory,
  limit = 400,
): Promise<NewsCategoryArticle[]> {
  const out: NewsCategoryArticle[] = [];
  const chunk = 100;
  let total = Infinity;

  while (out.length < Math.min(total, limit)) {
    const rowStart = out.length + 1; // inclusive, 1-indexed
    const rowEnd = rowStart + chunk - 1;
    const url = `${API_BASE}/news-categories//news?${qs({
      insId: cat.insId,
      categoryId: cat.subcategoryId,
      rowStart,
      rowEnd,
      lang: LANGS.bs,
    })}`;
    const res = await getJson<NewsCategoryResponse>(url);
    total = res.total ?? 0;
    if (!res.articles?.length) break;
    out.push(...res.articles);
    if (res.articles.length < chunk) break;
  }
  return out.slice(0, limit);
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pLimit from 'p-limit';
import { LANGS, PATHS, WEB_BASE } from './config.ts';
import { getBuffer } from './lib/http.ts';
import { cachedDownload } from './lib/cache.ts';
import { htmlToText, stripStyleNoise } from './lib/text.ts';
import { fetchCentralFeed, type CentralRow } from './sources/central.ts';
import { attachmentUrl, fetchArticle, type Attachment } from './sources/article.ts';
import { fetchCategoryArticles, type NewsCategoryArticle } from './sources/categories.ts';
import { toCourt } from './sources/courts.ts';
import { extractDocument } from './extract/document.ts';
import { ocrPdf } from './extract/ocr.ts';
import { ocrPdfWithModel, visionOcrAvailable } from './extract/vision.ts';
import {
  extractFields,
  inferSaleType,
  normaliseSaleType,
  parseDate,
  plausibleSaleDate,
} from './extract/fields.ts';
import { describeItem } from './extract/describe.ts';
import { tagItems } from './extract/items.ts';
import { redactText, redactTitle, redactVenue } from './redact.ts';
import { Listing, ListingFile, type Court } from './schema.ts';
import { PIPELINE_VERSION } from './version.ts';
import { analyzeAll, llmEnabled, type Analysis } from './extract/analyze.ts';
import { mergeAnalysis } from './extract/merge.ts';
import { buildReport, findDisagreements, type Disagreement } from './extract/disagreement.ts';

/**
 * Registry of institutions that publish sale notices, and the categories they
 * publish them under. Produced by `npm run discover`, which probes every
 * institution id on the portal; committed so a routine scrape needs no
 * discovery pass.
 *
 * This is the primary source. The central `sudske-prodaje` feed looks like the
 * canonical one but is badly incomplete: measured across the whole portal it
 * exposes 936 notices where the per-court categories expose 2,668. The gap is
 * not only courts it omits entirely (Sarajevo, Doboj, Foča and a dozen more) -
 * it also under-reports courts it *does* list, e.g. Općinski sud u Tuzli, which
 * appears with 3 notices in the feed and 693 in its own categories. Both routes
 * are crawled and merged by article id.
 */
interface CoverageEntry {
  id: number;
  name: string;
  categories: Array<{ id: number; name: string; total: number }>;
}

async function readCoverage(): Promise<CoverageEntry[]> {
  try {
    const raw = JSON.parse(await readFile('data/coverage.json', 'utf8')) as {
      institutions: CoverageEntry[];
    };
    return raw.institutions ?? [];
  } catch {
    console.warn('  ! data/coverage.json missing - run `npm run discover`; using central feed only');
    return [];
  }
}

interface Candidate {
  articleId: number;
  courtId: number;
  courtName: string;
  title: string;
  publishedDate: string | null;
  saleDate: string | null;
  saleTypeCode: string | null;
  saleTypeLabel: string | null;
  inlineHtml: string | null;
  documents: Attachment[];
  language: string | null;
}

function fromCentral(row: CentralRow): Candidate {
  return {
    articleId: row.id,
    courtId: row.insId,
    courtName: row.institucija,
    title: row.naslov ?? row.naslovL ?? '',
    publishedDate: parseDate(row.datumObjave),
    saleDate: parseDate(row.datumProdaje),
    saleTypeCode: row.vrstaPredmetaSifra,
    saleTypeLabel: row.vrstaPredmeta,
    inlineHtml: null,
    documents: [],
    language: null,
  };
}

function fromCategory(a: NewsCategoryArticle, courtId: number, courtName: string): Candidate {
  return {
    articleId: a.id,
    courtId,
    courtName,
    title: a.header ?? '',
    publishedDate: parseDate(a.date),
    saleDate: null,
    saleTypeCode: null,
    saleTypeLabel: null,
    inlineHtml: [a.description, a.content].filter(Boolean).join('\n'),
    documents: a.details?.dokumenti ?? [],
    language: null,
  };
}

/** Pull the best available text for a notice, cheapest source first. */
async function resolveText(c: Candidate): Promise<{
  text: string;
  source: Listing['extraction']['source'];
  docHashes: Map<number, string>;
}> {
  const docHashes = new Map<number, string>();

  const inline = stripStyleNoise(htmlToText(c.inlineHtml));
  // Inline bodies are usually a one-line teaser ("Dokument možete preuzeti…"),
  // so only trust them when there is real substance.
  if (inline.replace(/\s/g, '').length > 600) {
    return { text: inline, source: 'inline', docHashes };
  }

  for (const doc of c.documents) {
    try {
      const buf = await cachedDownload(doc.id, () => getBuffer(attachmentUrl(doc.id)));
      const extracted = await extractDocument(buf);
      docHashes.set(doc.id, extracted.sha256);

      if (extracted.needsOcr) {
        // A scanned, image-only PDF. The model reads these far better than a
        // local tesseract install, and needs nothing installed to do it.
        const ocr = visionOcrAvailable() ? await ocrPdfWithModel(buf) : await ocrPdf(buf);
        if (ocr.replace(/\s/g, '').length > 120) {
          return { text: ocr, source: 'ocr', docHashes };
        }
      }
      if (extracted.text.replace(/\s/g, '').length > 120) {
        return { text: extracted.text, source: extracted.kind as 'pdf' | 'docx' | 'doc', docHashes };
      }
    } catch (err) {
      console.warn(`  ! attachment ${doc.id} failed: ${(err as Error).message}`);
    }
  }

  // Fall back to whatever inline text exists, even if thin.
  return {
    text: inline,
    source: inline ? 'inline' : 'none',
    docHashes,
  };
}

interface Prepared {
  text: string;
  source: Listing['extraction']['source'];
  docHashes: Map<number, string>;
}

/** Fraction of the fields a bidder cares about that we actually filled. */
function scoreConfidence(l: Omit<Listing, 'extraction' | 'scrapedAt'>): number {
  const checks = [
    l.caseNumber,
    l.appraisedValue,
    l.startingPrice ?? l.appraisedValue,
    l.deposit,
    l.saleTime,
    l.auctionRound !== 'nepoznato' ? 1 : null,
    l.saleMethod !== 'nepoznato' ? 1 : null,
    l.itemDescription,
  ];
  return Number((checks.filter(Boolean).length / checks.length).toFixed(2));
}

function buildListing(
  c: Candidate,
  prepared: Prepared,
  courts: Map<number, Court>,
  analyses: Map<string, Analysis>,
  disagreements: Disagreement[],
): Listing | null {
  const court = courts.get(c.courtId) ?? toCourt(c.courtId, c.courtName);
  courts.set(c.courtId, court);

  const { text, source, docHashes } = prepared;
  const fields = extractFields(text, c.title);

  // The central feed always carries a sale date; category-sourced notices do
  // not, so fall back to a date parsed out of the notice body. Each source is
  // bounds-checked before it is trusted - courts do mistype the year into the
  // portal, and a hearing "in 2924" would otherwise be permanently upcoming and
  // sit at the top of the front page forever.
  const resolvedSaleDate =
    plausibleSaleDate(c.saleDate, c.publishedDate) ??
    plausibleSaleDate(findSaleDateInText(text), c.publishedDate) ??
    c.publishedDate;
  if (!resolvedSaleDate) return null;

  const id = `${c.courtId}-${c.articleId}`;
  const merged = mergeAnalysis(
    analyses.get(id),
    fields,
    describeItem(text, c.title),
    tagItems(c.title, describeItem(text, c.title), text.slice(0, 8000)),
    c.title,
    text,
  );
  const description = redactText(merged.itemDescription);

  // Two independent readings of the same document; where they differ, one of
  // them is wrong. Recorded for review rather than resolved silently.
  disagreements.push(
    ...findDisagreements(
      {
        id,
        court: court.name,
        sourceUrl: `${WEB_BASE}/${LANGS.bs}/${c.courtId}/article/${c.articleId}`,
      },
      analyses.get(id),
      fields,
    ),
  );

  const saleType =
    c.saleTypeCode || c.saleTypeLabel
      ? normaliseSaleType(c.saleTypeCode, c.saleTypeLabel)
      : (merged.saleType ?? inferSaleType(`${c.title}\n${text.slice(0, 4000)}`));

  const base = {
    id,
    articleId: c.articleId,
    court: court.name,
    courtId: court.id,
    entity: court.entity,
    caseNumber: merged.caseNumber,
    saleType,
    title: redactTitle(c.title),
    headline: redactText(merged.headline),
    itemDescription: description,
    itemTags: merged.itemTags,
    cadastral: merged.cadastral,
    location: {
      municipality: merged.municipality,
      settlement: null,
    },
    appraisedValue: merged.appraisedValue,
    startingPrice: merged.startingPrice,
    deposit: merged.deposit,
    auctionRound: merged.auctionRound,
    saleMethod: merged.saleMethod,
    saleDate: resolvedSaleDate,
    saleTime: merged.saleTime,
    auctionLocation: redactVenue(merged.auctionLocation),
    viewingInfo: redactText(fields.viewingInfo),
    publishedDate: c.publishedDate ?? resolvedSaleDate,
    sourceUrl: `${WEB_BASE}/${LANGS.bs}/${c.courtId}/article/${c.articleId}`,
    documents: c.documents.map((d) => ({
      id: d.id,
      name: d.naziv,
      type: (d.tipDoc ?? '').toUpperCase(),
      url: attachmentUrl(d.id),
      sha256: docHashes.get(d.id) ?? null,
    })),
    language: c.language,
  };

  const listing: Listing = {
    ...base,
    extraction: {
      pipelineVersion: PIPELINE_VERSION,
      source,
      confidence: scoreConfidence(base),
      llm: analyses.has(id),
    },
    scrapedAt: new Date().toISOString(),
  };

  const parsed = Listing.safeParse(listing);
  if (!parsed.success) {
    console.warn(`  ! schema reject ${listing.id}: ${parsed.error.issues[0]?.message}`);
    return null;
  }
  return parsed.data;
}

/** Last-resort sale date: the first future-looking date in the operative text. */
function findSaleDateInText(text: string): string | null {
  const matches = [...text.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g)];
  const today = new Date().toISOString().slice(0, 10);
  const dates = matches
    .map((m) => parseDate(`${m[1]}.${m[2]}.${m[3]}`))
    .filter((d): d is string => d !== null)
    .sort();
  return dates.find((d) => d >= today) ?? dates.at(-1) ?? null;
}

async function readExisting(): Promise<Map<string, Listing>> {
  try {
    const parsed = ListingFile.parse(JSON.parse(await readFile(PATHS.listings, 'utf8')));
    return new Map(parsed.listings.map((l) => [l.id, l]));
  } catch {
    return new Map();
  }
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function run(opts: { full?: boolean; limit?: number } = {}) {
  const startedAt = Date.now();
  const existing = await readExisting();
  console.log(`Loaded ${existing.size} existing listings`);

  console.log('Fetching central sales feed…');
  const central = await fetchCentralFeed();
  console.log(`  ${central.length} rows across ${new Set(central.map((r) => r.insId)).size} courts`);

  const candidates: Candidate[] = central.map(fromCentral);

  // Per-court categories: the fuller of the two routes.
  const coverage = await readCoverage();
  if (coverage.length) {
    console.log(`\nCrawling ${coverage.length} institutions' sale categories…`);
    const perCourt = pLimit(2);
    await Promise.all(
      coverage.map((inst) =>
        perCourt(async () => {
          for (const cat of inst.categories) {
            try {
              const articles = await fetchCategoryArticles(
                {
                  insId: inst.id,
                  moduleId: 0,
                  categoryId: cat.id,
                  categoryName: cat.name,
                  subcategoryId: cat.id,
                  subcategoryName: cat.name,
                },
                opts.full ? 2000 : 150,
              );
              candidates.push(...articles.map((a) => fromCategory(a, inst.id, inst.name)));
            } catch (err) {
              console.warn(`  ! ${inst.name} / ${cat.name}: ${(err as Error).message}`);
            }
          }
        }),
      ),
    );
    console.log(`  ${candidates.length - central.length} notices from categories`);
  }

  // Deduplicate: a notice can surface in more than one category.
  const byId = new Map<number, Candidate>();
  for (const c of candidates) if (!byId.has(c.articleId)) byId.set(c.articleId, c);
  let work = [...byId.values()];
  if (opts.limit) work = work.slice(0, opts.limit);

  console.log(`\nProcessing ${work.length} notices…`);
  const courts = new Map<number, Court>();
  const limit = pLimit(3);
  let done = 0;
  let reused = 0;

  // Pass 1 - fetch each notice and reduce it to text. Extraction proper waits
  // until every text is in hand, so the model pass can run as one batch.
  const reusedListings: Listing[] = [];
  const prepared = new Map<string, { candidate: Candidate; prepared: Prepared }>();

  await Promise.all(
    work.map((c) =>
      limit(async () => {
        const id = `${c.courtId}-${c.articleId}`;
        const prior = existing.get(id);

        // Incremental: a notice already extracted by *this* pipeline, with good
        // confidence and a document set we have seen, needs no re-download.
        // The version check is what makes a redaction or prompt fix propagate
        // to the existing archive instead of applying only to new notices.
        if (
          !opts.full &&
          prior &&
          prior.extraction.pipelineVersion === PIPELINE_VERSION &&
          prior.extraction.confidence >= 0.5 &&
          prior.documents.length
        ) {
          reusedListings.push(prior);
          reused++;
          if (++done % 100 === 0) console.log(`  ${done}/${work.length}`);
          return;
        }

        // Central-feed rows carry no attachments; fetch the article for them.
        if (!c.documents.length && !c.inlineHtml) {
          try {
            const art = await fetchArticle(c.articleId);
            c.documents = art.dokumenti ?? [];
            c.inlineHtml = art.sadrzaj;
            c.language = art.jezik?.jezik?.sifra ?? null;
          } catch (err) {
            console.warn(`  ! article ${c.articleId}: ${(err as Error).message}`);
          }
        }

        prepared.set(id, { candidate: c, prepared: await resolveText(c) });
        if (++done % 50 === 0) console.log(`  ${done}/${work.length}`);
      }),
    ),
  );

  // Pass 2 - read every notice with the model, reusing cached analyses.
  let analyses = new Map<string, Analysis>();
  if (llmEnabled()) {
    console.log('\nAnalysing notices…');
    const texts = new Map([...prepared].map(([id, p]) => [id, p.prepared.text]));
    analyses = await analyzeAll(texts);
  } else {
    console.log('\nNo OPENROUTER_API_KEY - using rule-based extraction only.');
  }

  // Pass 3 - build, redact and validate.
  const disagreements: Disagreement[] = [];
  const listings = [
    ...reusedListings,
    ...[...prepared.values()]
      .map(({ candidate, prepared: p }) =>
        buildListing(candidate, p, courts, analyses, disagreements),
      )
      .filter((l): l is Listing => l !== null),
  ];

  // Notices the portal no longer serves. The courts rotate old sales out of the
  // feeds, so a dataset built only from the current crawl silently deletes them
  // - a routine twice-daily run would erode the archive that is half the point
  // of this project. One such run dropped 690 records before this existed.
  //
  // Carrying them forward is also the only remaining path by which a fix to
  // src/redact.ts reaches them: they can never be rebuilt from source again,
  // because the source is gone. So redaction is re-applied on the way through
  // rather than trusting whatever was stored.
  //
  // A row deleted from data/listings.json by hand stays deleted - this reads
  // that file, not a separate cache - which is what makes a takedown stick for
  // any notice the portal has already dropped.
  const crawled = new Set(listings.map((l) => l.id));
  const retained = [...existing.values()].filter((l) => !crawled.has(l.id)).map(carryForward);
  listings.push(...retained);

  listings.sort((a, b) => (a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0));

  await writeJson(PATHS.listings, {
    generatedAt: new Date().toISOString(),
    count: listings.length,
    listings,
  });
  await writeJson(
    PATHS.quality,
    buildReport(disagreements, listings.length, analyses.size),
  );
  await writeJson(
    PATHS.courts,
    [...courts.values()].sort((a, b) => a.name.localeCompare(b.name, 'bs')),
  );

  report(listings, reused, retained.length, Date.now() - startedAt, disagreements);
}

/**
 * Bring a stored listing forward into a new run.
 *
 * Limited to what can be recomputed from the row itself - redaction and the
 * sale-date bound. The extracted *values* were produced by whatever pipeline
 * version the row records, and with the source document gone from the portal
 * there is no honest way to redo that; the row keeps its old version stamp to
 * say so. Privacy and an impossible date are the two things that must not be
 * left at whatever they happened to be written with, because both stay visible
 * on the site forever.
 */
function carryForward(l: Listing): Listing {
  return {
    ...l,
    title: redactTitle(l.title),
    headline: redactText(l.headline),
    itemDescription: redactText(l.itemDescription),
    auctionLocation: redactVenue(l.auctionLocation),
    viewingInfo: redactText(l.viewingInfo),
    saleDate: plausibleSaleDate(l.saleDate, l.publishedDate) ?? l.publishedDate,
  };
}

function report(
  listings: Listing[],
  reused: number,
  retained: number,
  ms: number,
  disagreements: Disagreement[],
) {
  const bySource = new Map<string, number>();
  for (const l of listings) bySource.set(l.extraction.source, (bySource.get(l.extraction.source) ?? 0) + 1);
  const avg =
    listings.reduce((s, l) => s + l.extraction.confidence, 0) / Math.max(listings.length, 1);
  const withPrice = listings.filter((l) => l.appraisedValue ?? l.startingPrice).length;
  const upcoming = listings.filter((l) => l.saleDate >= new Date().toISOString().slice(0, 10)).length;

  console.log(`\n── Summary ────────────────────────────`);
  console.log(`  listings         ${listings.length}  (${upcoming} upcoming)`);
  console.log(`  reused cached    ${reused}`);
  console.log(`  archived         ${retained}  (no longer served by the portal)`);
  console.log(`  courts           ${new Set(listings.map((l) => l.courtId)).size}`);
  console.log(`  text source      ${[...bySource].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  with case no.    ${listings.filter((l) => l.caseNumber).length}`);
  console.log(`  with a price     ${withPrice}`);
  console.log(`  avg confidence   ${avg.toFixed(2)}`);
  console.log(`  elapsed          ${(ms / 1000).toFixed(0)}s`);
  if (disagreements.length) {
    const byField = new Map<string, number>();
    for (const d of disagreements) byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
    console.log(
      `  disagreements    ${disagreements.length} (${[...byField]
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}) → ${PATHS.quality}`,
    );
  }
}

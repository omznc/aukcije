# Sudske prodaje BiH

An open, structured index of **court auction notices (sudske prodaje) in Bosnia
and Herzegovina**, scraped from the official [pravosudje.ba](https://pravosudje.ba)
portal and published as a static site plus a plain JSON dataset.

The official portal already has a country-wide search. This adds what it lacks:
browsing by **what is actually being sold** (monitors, tractors, flats — not
just the courts' five broad categories), extracted prices and deadlines, a
historical archive, RSS, and structured data you can download.

> Unofficial project. Every listing links back to the court's own document,
> which is the only authoritative record.

## What it does

```
pravosudje.ba API  →  attachments (PDF / DOCX / DOC)  →  text
                   →  LLM reads each notice → structured fields   (cached by document hash)
                   →  rule-based cross-check + PII redaction + validation
                   →  data/listings.json  →  Astro + Pagefind
```

Current dataset: **2,686 notices from 41 courts**, spanning 2011 to now. 95%
carry a case number and 77% a parsed price.

## Quick start

```bash
npm install
npm run scrape      # fetch + extract → data/listings.json
npm run verify      # sanity-check the dataset
npm run build       # static site → dist/
npm run dev         # local preview
npm test            # unit tests for the extractors
```

`npm run scrape` is incremental: notices already extracted with good confidence
and unchanged attachments are reused. Use `npm run scrape -- --full` to
re-extract everything, and `--limit=50` to work on a small sample.

Downloaded attachments are cached under `.cache/` (git-ignored), so re-running
after a parser change does not re-download anything.

The courts rotate old sales out of the portal's feeds, so a run finds fewer
notices than the archive holds — currently 1,996 of 2,686. Anything already in
`data/listings.json` that the crawl no longer sees is **carried forward** rather
than dropped; without that, a routine run quietly deletes history. Carried-forward
rows keep their original version stamp, since the source document they were built
from is gone, but redaction and the sale-date bound are re-applied on the way
through — those are the two things that stay visible on the site forever.

## Extraction

Each notice is read once by an LLM, which returns every field as structured
JSON: headline, item description, item tags, case number, prices, deposit,
hearing round/method/time, venue and cadastral references.

**Why not regexes.** These notices come from ~27 courts with no shared template.
Rule-based extraction turned into an open-ended chase — and its failures are
silent, producing plausible-looking wrong output rather than an error. In this
repo's history that meant debt amounts read as sale prices, table headers
published as item descriptions, and, worst, 26 records that shipped with the
debtor's name intact.

**What stays deterministic, deliberately:**

| Concern | Why it is not left to the model |
|---|---|
| **PII redaction** (`src/redact.ts`) | Runs *on* the model's output, never instead of it. A model can be told not to emit names; it cannot be relied on for the one field with legal consequences. |
| **Money invariants** (`src/extract/merge.ts`) | A price floor above the appraised value, or a deposit over the 10.000 KM statutory cap, is impossible. Violations fall back to the rule-derived number. |
| **Schema + gates** (`zod`, `scripts/verify.ts`) | Refuses to publish a dataset that is gutted, self-contradictory, or leaking personal data. |
| **The rules themselves** (`src/extract/fields.ts`) | The complete fallback path when no API key is set, so the project still works offline and for free. |

**Scanned PDFs.** A minority of attachments are images with no text layer.
Rather than installing poppler + tesseract everywhere, the PDF is handed to the
model, which transcribes it (`src/extract/vision.ts`). This recovers 61
documents that previously yielded nothing, handles Cyrillic without picking a
language pack up front, and keeps CI free of system packages. A local
tesseract install is still used as a fallback when no API key is set.

**Determinism and cost.** Results are cached under `.cache/llm/`, keyed by a
hash of the document text plus the prompt version. The same notice always
yields the same committed output, re-runs cost nothing, and only genuinely new
documents hit the API. Bump `PROMPT_VERSION` in `src/extract/analyze.ts` to
force re-analysis.

A full 1,400-notice backfill is a few hundred thousand tokens on a cheap model —
cents. Ongoing cost is a few dozen new notices a month.

### Configuration

Copy `.env.example` to `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...          # https://openrouter.ai/keys
LLM_MODEL=google/gemini-2.5-flash-lite   # any OpenRouter model id
LLM_CONCURRENCY=4
LLM_MAX_CALLS=2000                       # per-run cap, so a bad run can't overspend
```

In CI, set `OPENROUTER_API_KEY` as a repository secret and optionally
`LLM_MODEL` as a repository variable. Without a key the pipeline runs fully
offline on the rule-based path.

## Data

`data/listings.json` — one record per notice:

```jsonc
{
  "id": "80-166864",
  "court": "Osnovni sud u Bijeljini",
  "entity": "RS",                          // FBiH | RS | BD
  "caseNumber": "80 0 I 171697 25 I",
  "headline": "Ugaona garnitura, LCD TV, trpezarijski sto",
  "saleType": "ostalo",                    // the court's own category
  "itemTags": ["tv", "stolice"],           // what is actually being sold
  "itemDescription": "Ugaona garnitura …",
  "appraisedValue": { "amount": 2700, "currency": "BAM" },
  "startingPrice": { "amount": 1350, "currency": "BAM" },
  "deposit":       { "amount": 270,  "currency": "BAM" },
  "auctionRound": "prvo",
  "saleMethod": "usmeno-javno-nadmetanje",
  "saleDate": "2026-10-13",
  "saleTime": "09:00",
  "cadastral": { "kc": ["629/8"], "zkUlozak": ["8648"], "ko": ["Hrasnica"] },
  "sourceUrl": "https://pravosudje.ba/vstvfo/B/80/article/166864",
  "documents": [{ "id": 165826, "type": "DOCX", "url": "…", "sha256": "…" }],
  "extraction": { "source": "doc", "confidence": 0.88, "llm": false }
}
```

`extraction.confidence` is the fraction of high-value fields that were filled —
note that this measures *coverage, not correctness*.

`extraction.pipelineVersion` records which prompt/redaction/rules combination
built the row. Rows built by an older pipeline are rebuilt rather than reused,
so a fix reaches the whole archive on the next scheduled run instead of only
new notices. Bump the relevant number in `src/version.ts` to force that.

### Quality report

Both extraction paths run on every notice, so comparing them is free. Where the
model and the rules read the same document differently, one of them is wrong —
those cases land in `data/quality-report.json`:

```jsonc
{
  "comparable": 1400,
  "disagreements": 702,
  "byField": { "appraisedValue": 373, "deposit": 159, "caseNumber": 105, ... },
  "worst": [ { "field": "appraisedValue", "llm": 387200, "rules": 3.87,
               "ratio": 100051.68, "sourceUrl": "…" } ]
}
```

This is a **review queue, not a gate** — a disagreement says the two readings
differ, not which is right. In practice the extremes are usually a rule-parser
failure (`3.87 KM`, `50 KM`), which is what motivated going model-first; the
invariants in `src/extract/merge.ts` catch the reverse case, where the model
returns something impossible.

## Privacy

Auction notices name the debtor. This project deliberately publishes less than
the source does, in line with BiH's GDPR-aligned Law on Personal Data Protection
("Sl. glasnik BiH" 12/25, applied from 4 October 2025).

- **Published**: court, case number, item type and description, cadastral data,
  appraised value, starting price, deposit, hearing date/time/venue.
- **Not published**: debtor and creditor personal names, home addresses,
  national identifiers (JMBG), contact details, and the full notice text.
- Company parties are kept — a `d.o.o.` is not personal data.
- The authoritative full record stays with the court; every listing deep-links
  to it.

Takedown and correction requests: **contact@omarzunic.com**. Include the
listing id or URL; records are removed or corrected without delay.

`scripts/verify.ts` enforces this and **refuses to publish** if a personal
identifier, e-mail address, street address, or a debtor name surviving
redaction appears in the dataset. Those gates are not decorative — they caught
both a batch of impossible prices and a real name leak during development. See `src/redact.ts` and `/privatnost` on the site for the takedown
contact.

## Being a good citizen

Neither `pravosudje.ba` nor `portalfo1/2` publishes a `robots.txt` (both 404),
so the scraper self-limits: ~3 concurrent requests, ≥350 ms spacing with jitter,
exponential backoff, conditional reuse of cached documents, a descriptive
User-Agent with a contact URL, and a twice-daily schedule. Please keep it that
way if you fork this.

## Layout

```
src/
  config.ts            endpoints, politeness settings, category enum
  schema.ts            zod schema for a listing
  pipeline.ts          orchestration: fetch → extract → redact → write
  sources/             central feed, article detail, category fallback, courts
  extract/
    analyze.ts         LLM-first extraction, cached by document hash
    merge.ts           reconciles model output with rules, enforces invariants
    fields.ts          rule-based extraction (fallback + cross-check)
    describe.ts        item-description heuristics
    items.ts           item taxonomy used for browse-by-item
    document.ts, ocr.ts, municipality.ts
  redact.ts            personal-data minimisation
  lib/                 http (rate limiting, retries), text, cache
  site/                Astro app
scripts/verify.ts      post-scrape assertions
docs/API.md            the reverse-engineered upstream API
data/listings.json     the published dataset
```

## Deployment

The site is static and served from Cloudflare Pages, but it is **built in GitHub
Actions**, not by Pages' own build image: the build runs `.ts` files directly and
needs Node 24's native type stripping. `.github/workflows/deploy.yml` builds and
then uploads with `wrangler pages deploy`.

What that needs configured on the repository:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | token with **Cloudflare Pages: Edit** |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | the target account |
| Secret | `OPENROUTER_API_KEY` | used by the scrape job only |
| Variable | `SITE_URL` | e.g. `https://sudskeprodaje.omarzunic.com` |
| Variable | `LLM_MODEL` | optional override |

`SITE_URL` is baked into canonical tags, RSS, `sitemap.xml` and `llms.txt` at
build time, so an unset or stale value silently publishes wrong URLs. It falls
back to the production domain in `src/config.ts` when the variable is absent.

`npm run build` ends with `scripts/verify-build.ts`, which fails the build if
any route failed to generate. This matters because `astro build` can exit 0
having produced an empty site — a `getStaticPaths` that throws takes down every
dynamic route while still reporting success. Nothing is uploaded unless it
passes.

## Discovery

Generated at build time rather than checked into `public/`, because each one
needs the absolute site URL:

- `/sitemap.xml` — every page, with `lastmod` taken from each notice's own
  publication date so a daily rebuild does not claim the whole archive changed.
- `/robots.txt` — crawling allowed, including by AI crawlers; only Pagefind's
  index shards are excluded.
- `/llms.txt` — a brief for models that land here: what a "sudska prodaja" is,
  where the JSON lives, and the two caveats worth repeating (unofficial index,
  personal data removed by design).

## Automation

`.github/workflows/scrape.yml` runs twice daily on GitHub Actions (free for
public repos), verifies the result, commits `data/` only when it changed, and
opens an issue if the run fails. It then calls `deploy.yml` directly — it has to,
because a push made with `GITHUB_TOKEN` does not trigger `on: push` workflows, so
a refreshed dataset would otherwise never reach the site.

Because the whole judiciary sits behind one shared platform, a single upstream
change can break every court at once. `scripts/verify.ts` is the guard: it fails
loudly rather than letting a gutted dataset get published. When it fires, start
from `docs/API.md`.

## Licence

Code MIT. The underlying notices are official public documents of the courts of
Bosnia and Herzegovina; re-use them with attribution to the issuing court and a
link to the original, as the portal asks.

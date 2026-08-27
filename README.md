# Sudske prodaje BiH

An open, structured index of **court auction notices (sudske prodaje) in Bosnia
and Herzegovina**, scraped from the official [pravosudje.ba](https://pravosudje.ba)
portal and published as a static site plus a plain JSON dataset.

The official portal already has a country-wide search. This adds what it lacks:
browsing by **what is actually being sold** (monitors, tractors, flats - not
just the courts' five broad categories), extracted prices and deadlines, a
historical archive, a feed and a calendar per court and per category, a map, a
price reference, and structured data you can download.

The one thing here that is in no single source notice: when a lot fails to
sell it comes back cheaper, and linking hearings by case number makes that fall
visible. `/snizenja/` is that page.

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
npm run geo         # regenerate src/site/lib/geo.ts (rarely; see Map)
```

`npm run scrape` is incremental: notices already extracted with good confidence
and unchanged attachments are reused. Use `npm run scrape -- --full` to
re-extract everything, and `--limit=50` to work on a small sample.

Downloaded attachments are cached under `.cache/` (git-ignored), so re-running
after a parser change does not re-download anything.

The courts rotate old sales out of the portal's feeds, so a run finds fewer
notices than the archive holds - currently 1,996 of 2,686. Anything already in
`data/listings.json` that the crawl no longer sees is **carried forward** rather
than dropped; without that, a routine run quietly deletes history. Carried-forward
rows keep their original version stamp, since the source document they were built
from is gone, but redaction and the sale-date bound are re-applied on the way
through - those are the two things that stay visible on the site forever.

## Extraction

Each notice is read once by an LLM, which returns every field as structured
JSON: headline, item description, item tags, case number, prices, deposit,
hearing round/method/time, venue and cadastral references.

**Why not regexes.** These notices come from ~27 courts with no shared template.
Rule-based extraction turned into an open-ended chase - and its failures are
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

A full 1,400-notice backfill is a few hundred thousand tokens on a cheap model -
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

`data/listings.json` - one record per notice:

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

`extraction.confidence` is the fraction of high-value fields that were filled -
note that this measures *coverage, not correctness*.

`extraction.pipelineVersion` records which prompt/redaction/rules combination
built the row. Rows built by an older pipeline are rebuilt rather than reused,
so a fix reaches the whole archive on the next scheduled run instead of only
new notices. Bump the relevant number in `src/version.ts` to force that.

### Quality report

Both extraction paths run on every notice, so comparing them is free. Where the
model and the rules read the same document differently, one of them is wrong -
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

This is a **review queue, not a gate** - a disagreement says the two readings
differ, not which is right. In practice the extremes are usually a rule-parser
failure (`3.87 KM`, `50 KM`), which is what motivated going model-first; the
invariants in `src/extract/merge.ts` catch the reverse case, where the model
returns something impossible.

## Feeds and calendars

The site has no accounts and no backend, so there is nothing here that could
e-mail anyone a reminder. A feed and a calendar file are how a static site still
reaches someone on the day a deadline matters.

| | RSS | iCalendar |
|---|---|---|
| Everything | `/rss.xml` | `/kalendar.ics` |
| Price drops | `/snizenja/rss.xml` | `/snizenja/kalendar.ics` |
| One court | `/sudovi/{courtId}/rss.xml` | `/sudovi/{courtId}/kalendar.ics` |
| One category | `/predmeti/{tag}/rss.xml` | `/predmeti/{tag}/kalendar.ics` |
| One notice | - | `/oglas/{id}.ics` |

A feed of everything is the wrong grain - nobody is watching all 41 courts - so
the narrow ones are the point. `/predmeti/{tag}/rss.xml` is the feed the portal
cannot offer at all, because its own categories stop at five.

Calendars carry upcoming hearings only, and every event has **two alarms, seven
days and one day out**. The earlier one is the one that matters: the deadline
that actually binds is not the hearing but the deposit, which has to reach the
court's account before it.

Events are written as UTC instants rather than as a `TZID` plus a bundled
`VTIMEZONE`, so a client reads the same moment with no timezone rules of ours to
go stale; the local wall-clock time is resolved against the platform's own tz
database at build time, and the whole set regenerates twice a day. Where a notice
states no time, 09:00 is written and the event says so in its description.

`/sacuvano/` builds a calendar of saved notices **in the browser**, by fetching
each listing's own `.ics` and re-wrapping the `VEVENT` blocks. That is why
`src/site/lib/ics.ts` carries no dataset import - pulling `data/listings.json`
into that bundle to format a date would cost 4.6 MB - and why there is only one
description of an event rather than two that can drift.

## Share cards

Every listing has a 1200×630 PNG at `/og/{id}.png`, rendered at build time with
satori and resvg from the site's own fonts (checked in under
`src/site/assets/fonts/`, so no build reaches out to Google Fonts). These notices
circulate by being pasted into a chat, so for many readers the card *is* the
page; it carries what decides whether the link is worth opening - what is being
sold, what it starts at, how long is left.

A card is ~130 ms and there is one per notice, so an uncached build spends six
minutes redrawing an archive that has not changed. Each card is therefore keyed
by a hash of exactly the values printed on it and cached in `.cache/og`, one
image per listing, overwritten rather than accumulated. Settled listings hash the
same forever; the few dozen upcoming ones re-render daily because their countdown
is part of what is drawn. Cold build: ~6 min. Warm: ~8 s. CI restores the cache
in `deploy.yml`, and losing it costs time and nothing else.

## Map

`/mapa/` is one inline SVG - no tile server, no map library, no third-party
request, which is the same promise the footer makes about tracking. The national
border and one coordinate per place in the dataset are **generated once and
committed** as `src/site/lib/geo.ts`:

```bash
npm run geo   # re-run when new municipalities appear in the data
```

Checked in on purpose: the build runs twice daily in CI, and depending on two
public APIs being up would mean failing deploys for reasons that have nothing to
do with the auctions. Border from
[georgique/world-geojson](https://github.com/georgique/world-geojson), coordinates
from Nominatim - both **OpenStreetMap, ODbL**, and attributed on the page.

A notice names a municipality only when the extractor could read one; the rest
fall back to the seat of the publishing court, which is right to within a
district. The page prints how many landed each way, because a dot placed by
fallback is a weaker claim than one placed by the document.

## Prices

`/cijene/` is the archive used as what it is actually good for: median price per
m² by municipality, median starting price by category, and how both move by year.
Every figure carries its sample size, and the threshold for a row is five
measurable sales - a median off two observations is the kind of number people
quote back at each other as fact.

Two things it says out loud, because getting either wrong would make the page
misleading: price per m² can only be measured where a notice states exactly one
surface, which is a minority of them; and **every price in this dataset is a
starting price**. Courts publish what a lot is offered at, never what it sold
for or whether it sold, so no achieved price exists here and none should be
attributed to it.

## Tempo

`/tempo/` is the other thing that exists only once an archive holds both ends of
a case: how long a lot waits before it comes back, how often it comes back at
all, and when in the year hearings happen. No court reports its own pace, and no
single notice can show it.

Three rules keep it honest:

- **Hearings are counted by date, not by notice.** A court routinely publishes
  one notice per lot for a single hearing - 49 cases here carry two or more
  notices bearing the same date. Counted as notices, that is three rounds;
  counted as hearings it is one hearing with three things on offer. Reading it
  the wrong way invents a price fall out of the gap between two different lots,
  which it previously did in three of the 113 falls behind `/snizenja/`.
- **A fall is measured only where both hearings offered exactly one priced
  lot** - the same rule as price per m², for the same reason. Where a hearing put
  three priced lots on the table, no single number describes what it was asking.
- **Every figure is a lower bound.** The portal rotates old sales out of its
  feeds, so a repeat is visible only where the archive caught both hearings. A
  court that publishes tidily and for longer looks like it repeats more.

The strongest finding is a negative one, and the page leads with it: the fall
between two hearings is prescribed, so 89 of 110 measured falls are exactly one
third - at every court, for every kind of goods. A table of it per court would
be the same number sixteen times. What actually varies is the **wait**, from a
median of 33 days at one court to 85 at another, and that is the table that
leads. The 21 falls that are not a third are listed individually, each linking
to its own notice, because at that sample size an outlier is as likely to be a
misread document as a court doing something unusual.

## Structured data

Listing pages carry a `SaleEvent` with an `Offer`, plus a `BreadcrumbList`; the
home page carries `WebSite` (with a `SearchAction`) and a `Dataset` node
describing `/podaci.json`. `SaleEvent` rather than `Product` because what is
published is a hearing at a place and a time - nothing is sold from this domain.

Nearly all traffic here is someone searching for "prodaja stana Zenica sud"
rather than browsing, so what a crawler can make of a page matters more than
usual. `scripts/verify-build.ts` asserts the blocks are present, since a
serialisation that broke would otherwise show up only as a slow decline months
later.

## Privacy

Auction notices name the debtor. This project deliberately publishes less than
the source does, in line with BiH's GDPR-aligned Law on Personal Data Protection
("Sl. glasnik BiH" 12/25, applied from 4 October 2025).

- **Published**: court, case number, item type and description, cadastral data,
  appraised value, starting price, deposit, hearing date/time/venue.
- **Not published**: debtor and creditor personal names, home addresses,
  national identifiers (JMBG), contact details, and the full notice text.
- Company parties are kept - a `d.o.o.` is not personal data.
- The authoritative full record stays with the court; every listing deep-links
  to it.
- Saving a notice writes one `localStorage` key in the visitor's own browser.
  There is no account and no cookie behind it, nothing is sent anywhere, and
  `/sacuvano/` is where those keys are read back and can be cleared. Choosing a
  sheet in the header writes one more (`prikaz:tema`); those two keys are the
  whole of what this site stores.

Takedown and correction requests: **contact@omarzunic.com**. Include the
listing id or URL; records are removed or corrected without delay.

`scripts/verify.ts` enforces this and **refuses to publish** if a personal
identifier, e-mail address, street address, or a debtor name surviving
redaction appears in the dataset. Those gates are not decorative - they caught
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
    lib/dates.ts       hearing arithmetic - no dataset import, runs in the browser
    lib/ics.ts         iCalendar generation - likewise, for /sacuvano/
    lib/calendar.ts    the half of the above that knows about listings
    lib/feed.ts        one RSS builder, pointed at slices of the archive
    lib/costs.ts       what a lot costs once won - likewise dataset-free
    lib/geo.ts         GENERATED: country outline + place coordinates
    lib/og.ts          share cards (satori + resvg), cached by what they print
    lib/jsonld.ts      schema.org for listings and for the site
    lib/stats.ts       everything derived: drops, chains, medians, map buckets
    lib/theme.ts       paper or dark, and the toggle that chooses
    styles/global.css  fonts, motion, and the one place a colour is spelled out
scripts/verify.ts      post-scrape assertions
scripts/build-geo.ts   regenerates site/lib/geo.ts; run by hand, not by the build
docs/API.md            the reverse-engineered upstream API
data/listings.json     the published dataset
```

Three libraries under `site/lib/` are deliberately free of any dataset import -
`dates.ts`, `ics.ts` and `costs.ts` - because the browser uses them, and pulling
`data/listings.json` into a client bundle to format a date would ship 4.6 MB to
do it. `calendar.ts` holds the half of the calendar code that does know about
listings.

## Two sheets

The site is set on paper and on a dark equivalent of it, and the palette is the
only difference between them - same type, same rules, same spacing. Every colour
is a custom property declared once in `src/site/styles/global.css` through
`light-dark()`, and `tailwind.config.mjs` is a list of names pointing at those
properties, so no component knows which sheet it is being drawn on.

Which one a visitor gets is decided in this order:

1. their own choice, stored under `prikaz:tema` and applied by a small inline
   script in the head of `Base.astro` - before the first paint, since every page
   here is its own document and a late switch would flash on every navigation;
2. failing that, `prefers-color-scheme`, resolved by CSS alone and followed live
   as the system turns;
3. failing that - a browser without `light-dark()`, or with scripting off -
   paper, exactly as the site shipped before. The header's toggle is hidden in
   that case rather than offered and ignored.

Share cards stay on paper in both. They are opened in someone else's app, on
someone else's background, and a card that changed with the author's theme would
be the odd one out in a chat thread either way.

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

`deploy.yml` also restores `.cache/og` before building. That cache is a build
accelerator and never a correctness dependency - a cold run just spends six
minutes redrawing share cards instead of eight seconds reusing them.

`npm run build` ends with `scripts/verify-build.ts`, which fails the build if
any route failed to generate. This matters because `astro build` can exit 0
having produced an empty site - a `getStaticPaths` that throws takes down every
dynamic route while still reporting success. Nothing is uploaded unless it
passes.

## Discovery

Generated at build time rather than checked into `public/`, because each one
needs the absolute site URL:

- `/sitemap.xml` - every page, with `lastmod` taken from each notice's own
  publication date so a daily rebuild does not claim the whole archive changed.
- `/robots.txt` - crawling allowed, including by AI crawlers; only Pagefind's
  index shards are excluded.
- `/llms.txt` - a brief for models that land here: what a "sudska prodaja" is,
  where the JSON lives, the feed and calendar URL shapes, and the caveats worth
  repeating (unofficial index, personal data removed by design, and that every
  price is a starting price rather than an achieved one).
- `/og/{id}.png` and `/og/default.png` - the share cards behind `og:image`.

## Automation

`.github/workflows/scrape.yml` runs twice daily on GitHub Actions (free for
public repos), verifies the result, commits `data/` only when it changed, and
opens an issue if the run fails. It then calls `deploy.yml` directly - it has to,
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

The map's geometry - the national border and the place coordinates in
`src/site/lib/geo.ts` - is derived from **OpenStreetMap** and is used under the
[ODbL](https://opendatacommons.org/licenses/odbl/), attributed on `/mapa/`. It is
not covered by the MIT grant above.

Fonts under `src/site/assets/fonts/` are Instrument Sans, Instrument Serif and
JetBrains Mono, all under the SIL Open Font License.

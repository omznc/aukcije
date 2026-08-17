# The pravosudje.ba backend, as observed

Everything here was verified live against the portal. None of it is officially
documented, so treat this file as the reference when something breaks - a
scrape failure is far more likely to be an upstream change than a bug here.

## Architecture

Every BiH court website is a tenant of one shared CMS the portal calls
**vstvfo** (VSTV = Visoko sudsko i tužilačko vijeće). It is a client-rendered
**Next.js** frontend over an **Express** API backed by **Oracle** - the database
shows through whenever a required parameter is missing:

```
ORA-20010: GREŠKA! Ne postoji jezik sa šifrom !
ORA-06512: at "PORTAL_ADMIN.JEZICI_PKG", line 99
```

API mirrors, both serving the same data:

```
https://portalfo1.pravosudje.ba/vstvfo-api
https://portalfo2.pravosudje.ba/vstvfo-api   ← what the shipped frontend uses
```

Web pages live under `https://<court>.pravosudje.ba/vstvfo/<lang>/<insId>/…`,
and the apex `pravosudje.ba` serves **any** court's content, so there is no need
to resolve per-court subdomains.

Language segment: `B` Bosanski, `H` Hrvatski, `S` Srpski (latinica),
`Sc` Srpski (ćirilica), `E` English.

### robots.txt

Both hosts return **404** for `/robots.txt` - no crawl directives are published
at all. The scraper self-limits anyway (see `src/config.ts`): ~3 concurrent
requests, ≥350 ms spacing with jitter, exponential backoff, descriptive
User-Agent with a contact URL.

## Endpoints

### 1. Central court-sales feed

```
GET /vstvfo-api/sudske-prodaje?page=0&pageSize=200
    &insId=&vrstaPredmeta=&datumObjaveOd=&datumObjaveDo=&datumProdajeOd=&datumProdajeDo=
```

Backs `pravosudje.ba/vstvfo/B/10001/sudske-prodaje`. Gotchas:

- `page` is **0-indexed**.
- Calling it with **no parameters returns 500** - always send paging.
- The response is a **bare array with no envelope**; the grand total is repeated
  on every row as `total`, with `RB` as the 1-based row number.
- `pageSize=200` is served without complaint.

```jsonc
[{
  "id": 166864,                    // article id
  "vrstaPredmeta": "Ostalo",
  "vrstaPredmetaSifra": "OST",     // NEK | VOZ | TEH | NAM | OST
  "vrstaPredmetaID": 5,
  "naslov": "…", "naslovL": "…", "naslovC": "…",   // neutral / Latin / Cyrillic
  "datumObjave": "05.08.2026",
  "datumProdaje": "13.10.2026",
  "insId": 80,
  "institucija": "  Osnovni sud u Bijeljini  ",     // note the padding
  "RB": 1,
  "total": 936
}]
```

**The category enum has five values, not four.** `Namještaj` (`NAM`) is a
distinct category alongside Nekretnine, Vozila, Tehnika and Ostalo.

### ⚠ This feed is badly incomplete - do not treat it as canonical

It looks like the authoritative country-wide source. It is not. Measured across
every institution on the portal (`npm run discover`):

```
notices reachable via /sudske-prodaje ............   936
notices reachable via per-court categories ....... 2,668
institutions publishing sales ....................    41
   of which the central feed exposes at all ......    26
```

Two separate failures:

1. **Courts missing entirely.** 15 institutions return `total: 0` here while
   publishing normally through their own categories - including Općinski sud u
   Sarajevu (465+ notices), Osnovni sud u Doboju, Foči, Prijedoru, Tešnju,
   Konjicu, Velikoj Kladuši.

2. **Courts under-reported.** Worse, and easy to miss: a court can appear in the
   feed with a handful of notices while holding hundreds. Općinski sud u Tuzli
   shows **3** notices in the feed and has **693** in its categories. Kakanj:
   1 vs 113. Zenica: 1 vs 75.

Because a court *is* present, nothing signals that 99% of its notices are
absent. Crawl endpoint 3 for every institution and merge on article id; use
this feed only as a supplementary source (it carries `datumProdaje` and the
`vrstaPredmeta` code, which the category route does not).

### 2. Article detail

```
GET /vstvfo-api/vijest/{articleId}?lang=B
```

`lang` is **mandatory**; omitting it raises the `ORA-20010` error above.
Requesting `B` still returns Cyrillic-authored notices in their original script -
`jezik.jezik.sifra` tells you which script it actually is.

Fields that matter: `sadrzaj` (HTML body), `dokumenti[]` (attachments),
`datumProdaje`, `vrstaPredmetaSifra`, `kategorija[]`, `jezik`.

`sadrzaj` is pasted out of Microsoft Word and carries large `<style>` blocks and
`<!--[if gte mso 9]>` conditional comments. Naive tag-stripping leaks CSS into
the text - see `htmlToText` and `stripStyleNoise` in `src/lib/text.ts`.

For most courts `sadrzaj` is only a teaser ("Dokument možete preuzeti na linku s
desne strane."); the operative text lives in the attachment. Measured over a
random sample of 45 notices, the median inline body was ~275 characters.

### 3. Category news feed - for courts missing from the central feed

```
GET /vstvfo-api/news-categories//news?insId=65&categoryId=11625&rowStart=1&rowEnd=100&lang=B
```

The **double slash is genuine** - the frontend interpolates an always-empty
segment there. Paging uses **1-indexed, inclusive** `rowStart`/`rowEnd`, not
page numbers, and 100 rows per request is served fine.

```jsonc
{ "articles": [{ "id": 166855, "header": "…", "date": "05.08.2026.",
                 "description": "…", "content": "<html>",
                 "details": { "dokumenti": [ /* … */ ] } }],
  "total": 148 }
```

Attachments come back **inline**, so no per-article fetch is needed here.

Discovering which categories hold sales: fetch the court's landing page
(`/vstvfo/B/{insId}`) and read `__NEXT_DATA__.props.pageProps.navigationItems`.
Category pages are server-rendered, so the tree is available without executing
JavaScript. Note the *first page* of a category is in the SSR payload too, but
**pagination is client-side only** - that is what endpoint 3 is for.

### 4. Attachment download

```
GET /vstvfo-api/vijest/download/{documentId}
```

`documentId` comes from `dokumenti[].id` and differs from the article id.
Everything is served as `application/octet-stream` regardless of real type, and
the declared `tipDoc` is not always right, so sniff by magic bytes
(`src/extract/document.ts`).

Observed format mix across the corpus: roughly **40% PDF, 40% DOCX, 20% legacy
DOC** (OLE2). PDF is *not* the dominant format. A small minority of PDFs are
scanned images with no text layer and need OCR.

### 5. Institution lookup

```
GET /vstvfo-api/institucija/{insId}
```

Returns `{ id, naziv, … }`. Useful for naming courts found by id.

## Endpoints that do not exist

Guessed paths return `500` with `Server error: … requested //<path>`, which is
the Express catch-all rather than a real error. Confirmed absent:
`/institucije`, `/navigacija`, `/vijesti/{insId}`, `/sudske-prodaje/{id}`,
`/kategorije-vijesti/…`, `/napredna-pretraga`.

## Data shape notes

- **Amounts** use `1.234.567,89`, but some courts write `2.000.00`, using the dot
  as both thousands *and* decimal separator. See `parseAmount`.
- **Case numbers** look like `65 0 Ip 1177038 25 Ip` - court code, a zero, a
  procedure marker, sequence, two-digit year, marker.
- **Court names embed their seat in the locative case** ("… u Sarajevu"), which
  needs a lookup table to get back to the nominative - see
  `src/extract/municipality.ts`.
- **Number labels** are written `br.`, `br` or `broj` interchangeably, and
  `k.o.` appears in both cases; patterns must tolerate all of it.
- The archive spans **2013 to the present**, so most records are historical.
  Only a few dozen sales are upcoming at any moment.

import type { APIRoute } from 'astro';
import { listings, upcoming, courts, itemCategories, generatedAt } from '../lib/data.ts';

/**
 * llms.txt (llmstxt.org): a single-page brief for a model that lands here.
 *
 * Written in English on purpose even though the site is in Bosnian. The point
 * is to translate the domain - "sudska prodaja" is a court-ordered auction, the
 * "zaključak" is the binding document - so an assistant answering a question
 * about this data does not have to infer any of it from a stray listing page.
 *
 * It also states the two things most likely to be got wrong when summarising
 * this site: the index is unofficial, and personal data has been stripped by
 * design rather than being missing from the source.
 */
export const GET: APIRoute = ({ site }) => {
  const base = site?.href.replace(/\/$/, '') ?? '';
  const years = [...new Set(listings.map((l) => l.saleDate.slice(0, 4)))].sort();
  const span = `${years[0]}–${years[years.length - 1]}`;

  const body = `# Sudske prodaje BiH - court auction notices in Bosnia and Herzegovina

> An open, structured index of court-ordered sale notices ("sudske prodaje",
> also called licitacije) published by the courts of Bosnia and Herzegovina on
> the official portal pravosudje.ba. Notices are fetched twice daily, read out
> of their PDF/DOCX attachments, and republished as browsable pages and a plain
> JSON dataset.

Dataset as of ${generatedAt.slice(0, 10)}: ${listings.length} notices from ${courts.length} courts,
covering sale dates ${span}, of which ${upcoming.length} are still upcoming.

What is sold: real estate (nekretnine), vehicles (vozila), machinery and
electronics (tehnika), furniture (namještaj), and everything else (ostalo).
Amounts are in convertible marks (KM / BAM). A notice states an appraised value
(procijenjena vrijednost), a minimum accepted price for that hearing round
(najniža cijena), a deposit (osiguranje), and the date, time and venue of the
hearing (ročište).

Important caveats to repeat to anyone relying on this:

- This is an unofficial index. The court's own document (the zaključak) is the
  only authoritative record, and every listing links back to it.
- Fields are extracted automatically and can be wrong. Verify against the
  linked original before acting on a price or a deadline.
- Every price here is a *starting* price for a hearing. Courts do not publish
  what a lot sold for, or whether it sold at all, so no achieved price exists
  in this dataset and none should be attributed to it.
- Names of debtors and other individuals, home addresses, national identifiers
  (JMBG) and contact details are deliberately removed. Their absence is a
  privacy decision, not a gap in the source.

## Data

- [Full dataset as JSON](${base}/podaci.json): every listing the site renders, with a \`generatedAt\` stamp. CORS is open.
- [Sitemap](${base}/sitemap.xml): every page, with last-modified dates.

## Feeds and calendars

Every court and every item category has its own RSS feed and its own iCalendar
file, so a subscription can be as narrow as "vehicles sold by the court in
Tuzla". Calendars carry only upcoming hearings and each event has two alarms,
seven days and one day out - the earlier one because the deposit has to reach
the court's account before the hearing, not on the day of it.

- [RSS, everything](${base}/rss.xml): the 100 most recently published notices.
- [RSS, price drops](${base}/snizenja/rss.xml): lots that came back cheaper, steepest first.
- [Calendar, everything upcoming](${base}/kalendar.ics)
- Per court: \`${base}/sudovi/{courtId}/rss.xml\` and \`${base}/sudovi/{courtId}/kalendar.ics\`
- Per category: \`${base}/predmeti/{tag}/rss.xml\` and \`${base}/predmeti/{tag}/kalendar.ics\`
- Per notice: \`${base}/oglas/{id}.ics\`

## Browse

- [Current auctions](${base}/): notices whose hearing date has not passed.
- [Price drops](${base}/snizenja/): open hearings whose price has fallen. Where the archive holds an earlier hearing for the same case number, the fall is measured against that hearing's own starting price; otherwise against the court's appraisal. The first is evidence the lot did not sell, and is the one thing here that is in no single source notice.
- [By item](${base}/predmeti/): ${itemCategories.length} categories of what is actually being sold, finer than the portal's five.
- [By court](${base}/sudovi/): all ${courts.length} courts that have published a notice.
- [Map](${base}/mapa/): where the sales are, by municipality and by court.
- [Archive](${base}/arhiva/): past auctions, useful as a price reference.
- [Prices](${base}/cijene/): median price per m² by municipality, median starting price by category, and how both move by year. Every figure carries its sample size; the samples are small.
- [Search](${base}/pretraga/): full-text, runs in the browser.

## Background

- [How to bid](${base}/kako-se-nadmetati/): what the deposit, the hearing rounds and the sale methods mean in practice.
- [Privacy and takedown](${base}/privatnost/): what is published, what is not, and how to request removal or correction.
- [Original source](https://pravosudje.ba/vstvfo/B/10001/sudske-prodaje): the judiciary's own portal.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

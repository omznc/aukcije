import type { Listing } from '../../schema.ts';
import { SALE_TYPE_LABELS, TAG_BY_ID, listings, courts, generatedAt } from './data.ts';
import { headline } from './headline.ts';
import { zonedInstant, DEFAULT_HOUR } from './ics.ts';

/**
 * Structured data.
 *
 * Nearly all of this site's traffic is someone searching for "prodaja stana
 * Zenica sud" rather than browsing it, so what a crawler can make of a listing
 * page matters more here than on most sites. Everything below is already on the
 * page in Bosnian prose; this states it again in a form a machine can read
 * without guessing which number is the price.
 *
 * `SaleEvent` rather than `Product`: what is published is a hearing at a place
 * and a time, and the lot is what it is about. Nobody is selling anything from
 * this domain.
 */

const ISO = (date: string, time: string | null) =>
  new Date(zonedInstant(date, time ?? DEFAULT_HOUR)).toISOString().replace(/\.\d{3}/, '');

export function listingJsonLd(l: Listing, base: string): object {
  const url = `${base}/oglas/${l.id}/`;
  const start = ISO(l.saleDate, l.saleTime);
  const price = l.startingPrice?.amount ?? null;
  const keywords = l.itemTags.map((t) => TAG_BY_ID.get(t)?.label ?? t).join(', ') || undefined;

  // One offer node, referenced from both the hearing and the lot. Google reads
  // the two as separate items and asks each for a price of its own.
  const offer =
    price === null
      ? null
      : {
          '@type': 'Offer',
          '@id': `${url}#ponuda`,
          // The starting price, not a sale price: this is the lowest bid
          // the court will accept at this hearing.
          price,
          priceCurrency: 'BAM',
          url,
          availability: 'https://schema.org/LimitedAvailability',
          validThrough: start,
          seller: { '@type': 'GovernmentOrganization', name: l.court },
        };

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SaleEvent',
        '@id': `${url}#rociste`,
        name: `${headline(l)} - ${l.court}`,
        description: l.itemDescription ?? `Sudska prodaja: ${headline(l)}`,
        url,
        startDate: start,
        // Notices state a start and never an end; an hour is the placeholder the
        // calendar file uses too, and marking it absent would be worse.
        endDate: new Date(Date.parse(start) + 3_600_000).toISOString().replace(/\.\d{3}/, ''),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        isAccessibleForFree: false,
        image: `${base}/og/${l.id}.png`,
        location: {
          '@type': 'Place',
          name: l.auctionLocation ?? l.court,
          address: {
            '@type': 'PostalAddress',
            addressLocality: l.location?.municipality ?? undefined,
            addressCountry: 'BA',
          },
        },
        organizer: {
          '@type': 'GovernmentOrganization',
          name: l.court,
          url: l.sourceUrl,
        },
        keywords,
        about: offer
          ? {
              '@type': 'Product',
              name: headline(l),
              description: l.itemDescription ?? undefined,
              category: SALE_TYPE_LABELS[l.saleType],
              keywords,
              image: `${base}/og/${l.id}.png`,
              offers: offer,
            }
          : // A notice that names no starting price leaves nothing to offer, and
            // a Product offering nothing is a warning rather than a result. The
            // lot is still named; it just is not priced here.
            {
              '@type': 'Thing',
              name: headline(l),
              description: l.itemDescription ?? undefined,
            },
        ...(offer ? { offers: offer } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Aktuelne', item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: 'Sudovi', item: `${base}/sudovi/` },
          { '@type': 'ListItem', position: 3, name: l.court, item: `${base}/sudovi/${l.courtId}/` },
          { '@type': 'ListItem', position: 4, name: headline(l), item: url },
        ],
      },
    ],
  };
}

/**
 * The site itself, plus the dataset behind it.
 *
 * The `Dataset` node is the one that earns its keep: this is open data with a
 * licence and a stable URL, and stating so is how it turns up in a dataset
 * search rather than only in a web one.
 */
export function siteJsonLd(base: string): object {
  const years = [...new Set(listings.map((l) => l.saleDate.slice(0, 4)))].sort();

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: `${base}/`,
        name: 'Sudske prodaje BiH',
        inLanguage: 'bs',
        description:
          'Nezavisni indeks sudskih prodaja (licitacija) u Bosni i Hercegovini, sa arhivom cijena i otvorenim podacima.',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${base}/pretraga/?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Dataset',
        '@id': `${base}/#dataset`,
        name: 'Sudske prodaje u Bosni i Hercegovini',
        description: `Strukturirani zapisi o ${listings.length} oglasa sudskih prodaja iz ${courts.length} sudova u BiH, ${years[0]}–${years.at(-1)}. Lični podaci stranaka su uklonjeni.`,
        url: `${base}/`,
        isAccessibleForFree: true,
        license: 'https://opensource.org/licenses/MIT',
        creator: { '@type': 'Person', name: 'Omar Zunić', url: 'https://omarzunic.com' },
        temporalCoverage: `${years[0]}/${years.at(-1)}`,
        spatialCoverage: { '@type': 'Country', name: 'Bosna i Hercegovina' },
        dateModified: generatedAt.slice(0, 10),
        keywords: ['sudske prodaje', 'licitacije', 'javne prodaje', 'nekretnine', 'BiH'],
        distribution: [
          {
            '@type': 'DataDownload',
            encodingFormat: 'application/json',
            contentUrl: `${base}/podaci.json`,
          },
        ],
        isBasedOn: 'https://pravosudje.ba/vstvfo/B/10001/sudske-prodaje',
      },
    ],
  };
}

import { API_BASE, PAGE_SIZE } from '../config.ts';
import { getJson, qs } from '../lib/http.ts';

/**
 * The country-wide "Sudske prodaje" feed backing
 * pravosudje.ba/vstvfo/B/10001/sudske-prodaje.
 *
 * Quirks worth knowing:
 *  - `page` is 0-indexed.
 *  - There is no envelope: the response is a bare array, and the grand total is
 *    repeated on every row as `total` (with `RB` as the 1-based row number).
 *  - Calling it with no params at all returns 500; always send paging.
 *  - It only covers courts that file notices through the structured sales
 *    module. Several courts (notably Općinski sud u Sarajevu) publish sales as
 *    ordinary news and are entirely absent here - see ./categories.ts.
 */
export interface CentralRow {
  id: number;
  vrstaPredmeta: string | null;
  vrstaPredmetaSifra: string | null;
  vrstaPredmetaID: number | null;
  naslov: string;
  naslovL: string | null;
  naslovC: string | null;
  datumObjave: string;
  datumProdaje: string;
  insId: number;
  institucija: string;
  RB: number;
  total: number;
}

export async function fetchCentralFeed(opts: { insId?: number } = {}): Promise<CentralRow[]> {
  const rows: CentralRow[] = [];
  const seen = new Set<number>();
  let page = 0;
  let total = Infinity;

  while (rows.length < total) {
    const url = `${API_BASE}/sudske-prodaje?${qs({
      page,
      pageSize: PAGE_SIZE,
      insId: opts.insId ?? null,
    })}`;
    const batch = await getJson<CentralRow[]>(url);
    if (!Array.isArray(batch) || batch.length === 0) break;

    total = batch[0].total ?? rows.length + batch.length;
    for (const row of batch) {
      // The feed can repeat rows across page boundaries when new notices land
      // mid-crawl; key on id so we never double-count.
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    page++;
    if (page > 200) break; // safety valve against a pathological total
  }
  return rows;
}

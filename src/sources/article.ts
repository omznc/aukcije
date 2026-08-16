import { API_BASE, LANGS } from '../config.ts';
import { getJson } from '../lib/http.ts';

export interface Attachment {
  id: number;
  vjeId: number;
  naziv: string;
  nazivFajla: string;
  opis: string | null;
  tipDoc: string;
  tipDocLower: string;
}

export interface Article {
  id: number;
  naslov: string;
  podnaslov: string | null;
  datum: string;
  sadrzaj: string | null;
  datumVijesti: string | null;
  datumProdaje: string | null;
  vrstaPredmeta: string | null;
  vrstaPredmetaSifra: string | null;
  insId: number;
  kategorija: Array<{ id: number; parent: number | null; naziv: string }>;
  jezik: { jezik?: { naziv: string; sifra: string }; jezici?: unknown[] } | null;
  dokumenti: Attachment[] | null;
}

/**
 * Full article record. The `lang` query param is mandatory — omitting it makes
 * the Oracle backend raise `ORA-20010: Ne postoji jezik sa šifrom`. Requesting
 * `B` still returns Cyrillic-authored notices in their original script, with
 * `jezik.jezik.sifra` telling us what that script actually is.
 */
export function fetchArticle(id: number, lang: string = LANGS.bs): Promise<Article> {
  return getJson<Article>(`${API_BASE}/vijest/${id}?lang=${lang}`);
}

export function attachmentUrl(docId: number): string {
  return `${API_BASE}/vijest/download/${docId}`;
}

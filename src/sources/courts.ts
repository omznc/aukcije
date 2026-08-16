import { API_BASE } from '../config.ts';
import { getJson } from '../lib/http.ts';
import type { Court, Entity } from '../schema.ts';
import { slugify, toLatin } from '../lib/text.ts';

/**
 * BiH's judiciary is split across two entities plus Brčko District, and each
 * uses different court nomenclature — which conveniently makes the entity
 * derivable from the court's name.
 *
 *   FBiH: Općinski / Kantonalni / Vrhovni sud FBiH
 *   RS:   Osnovni / Okružni / Okružni privredni sud
 *   BD:   anything naming Brčko distrikt
 *
 * This matters for the UI: enforcement rules and price floors differ by entity,
 * notably after FBiH's December 2024 amendments.
 */
export function entityOf(courtName: string): Entity {
  const n = toLatin(courtName);
  if (/br[cč]ko/i.test(n)) return 'BD';
  // Adjectives decline ("Okružni sud" / "Okružno tužilaštvo"), so match stems.
  if (/op[cć]insk\w*|kantonaln\w*|[zž]upanijsk\w*|federacije|fbih/i.test(n)) return 'FBiH';
  if (/osnovn\w*|okru[zž]n\w*|republike\s+srpske|\brs\b/i.test(n)) return 'RS';
  return 'FBiH';
}

interface Institucija {
  id: number;
  naziv: string;
  vazi: string;
}

export async function fetchInstitution(id: number): Promise<Institucija | null> {
  try {
    return await getJson<Institucija>(`${API_BASE}/institucija/${id}`);
  } catch {
    return null;
  }
}

export function toCourt(id: number, rawName: string): Court {
  const name = rawName.replace(/\s+/g, ' ').trim();
  return {
    id,
    name,
    slug: slugify(name),
    entity: entityOf(name),
    host: null,
  };
}

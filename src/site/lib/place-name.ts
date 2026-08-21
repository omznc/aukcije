/**
 * How two spellings of one place are recognised as the same place.
 *
 * Nothing here decides where a place is - that is the gazetteer's job, baked
 * into geo.ts. This decides only what counts as the same name, and it has to
 * be forgiving: the coordinates are keyed by strings that clerks typed, and
 * they typed "SARAJEVO" and "Sarajevo", "Doboj Istok" and "Doboj-Istok",
 * "Ćoralići" and "Čoralići" - a caps-lock key, a hyphen and a slipped
 * diacritic, none of which move a village.
 *
 * Diacritics are folded rather than compared because the archive's are
 * unreliable in exactly one direction: they go missing or land on the wrong
 * letter. Two genuinely different BiH settlements whose names differ only by a
 * diacritic would collide here; none are known, and a collision would put a
 * dot a few kilometres off, where the alternative - the status quo - is no dot
 * at all.
 *
 * Kept out of geo.ts because that file is generated: this is the one part of
 * the lookup that is a decision rather than a fetched fact.
 */
export function foldPlaceName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

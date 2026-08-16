/**
 * Court names embed their seat in the locative case ("Općinski sud u Sarajevu",
 * "Osnovni sud u Bijeljini"), but users search and filter on the nominative
 * ("Sarajevo", "Bijeljina").
 *
 * BiH place-name declension is irregular enough — Banjoj Luci → Banja Luka,
 * Sokocu → Sokolac, Širokom Brijegu → Široki Brijeg — that a lookup table is
 * more honest than a suffix rule. Anything unrecognised falls back to a
 * conservative suffix heuristic and is returned as-is when that fails.
 */
const LOCATIVE_TO_NOMINATIVE = new Map<string, string>(
  Object.entries({
    sarajevu: 'Sarajevo',
    'istocnom sarajevu': 'Istočno Sarajevo',
    bijeljini: 'Bijeljina',
    tuzli: 'Tuzla',
    mostaru: 'Mostar',
    zenici: 'Zenica',
    'banjoj luci': 'Banja Luka',
    banjaluci: 'Banja Luka',
    bugojnu: 'Bugojno',
    travniku: 'Travnik',
    lukavcu: 'Lukavac',
    zivinicama: 'Živinice',
    gradaccu: 'Gradačac',
    kaknju: 'Kakanj',
    zavidovicima: 'Zavidovići',
    zepcu: 'Žepče',
    gorazdu: 'Goražde',
    citluku: 'Čitluk',
    'sirokom brijegu': 'Široki Brijeg',
    livnu: 'Livno',
    derventi: 'Derventa',
    sokocu: 'Sokolac',
    cazinu: 'Cazin',
    jajcu: 'Jajce',
    banovicima: 'Banovići',
    prijedoru: 'Prijedor',
    trebinju: 'Trebinje',
    brckom: 'Brčko',
    brcko: 'Brčko',
    'velikoj kladusi': 'Velika Kladuša',
    bihacu: 'Bihać',
    konjicu: 'Konjic',
    visokom: 'Visoko',
    kiseljaku: 'Kiseljak',
    orasju: 'Orašje',
    doboju: 'Doboj',
    prnjavoru: 'Prnjavor',
    gradisci: 'Gradiška',
    modrici: 'Modriča',
    zvorniku: 'Zvornik',
    vlasenici: 'Vlasenica',
    foci: 'Foča',
    nevesinju: 'Nevesinje',
    mrkonjicgradu: 'Mrkonjić Grad',
    kotorvarosu: 'Kotor Varoš',
    srebrenici: 'Srebrenica',
    kljucu: 'Ključ',
    sanskommostu: 'Sanski Most',
    novomgradu: 'Novi Grad',
    tesnju: 'Tešanj',
    maglaju: 'Maglaj',
    olovu: 'Olovo',
    breze: 'Breza',
    vitezu: 'Vitez',
    busovaci: 'Busovača',
    prozoru: 'Prozor',
    stocu: 'Stolac',
    capljini: 'Čapljina',
    ljubuskom: 'Ljubuški',
    posusju: 'Posušje',
    tomislavgradu: 'Tomislavgrad',
  }),
);

/** Strip diacritics and collapse spaces for table lookup only. */
function key(s: string): string {
  return s
    .toLocaleLowerCase('bs')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toNominative(locative: string | null): string | null {
  if (!locative) return null;
  const k = key(locative);
  const hit = LOCATIVE_TO_NOMINATIVE.get(k) ?? LOCATIVE_TO_NOMINATIVE.get(k.replace(/\s+/g, ''));
  if (hit) return hit;

  // Conservative fallback for regular masculine locatives ("Prijedoru" →
  // "Prijedor"): drop a trailing -u when what remains still looks like a name.
  if (/[bcdfghjklmnprstvzčćžšđ]u$/i.test(locative) && locative.length > 4) {
    return locative.slice(0, -1);
  }
  return locative;
}

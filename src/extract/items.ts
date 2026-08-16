import { fold } from '../lib/text.ts';

/**
 * Item-level tagging.
 *
 * The portal's own category (`nekretnine` / `vozila` / `tehnika` / `namjestaj` /
 * `ostalo`) is far too coarse to shop with — "tehnika" alone covers monitors,
 * lathes and refrigerators. These tags come from the words in the notice
 * itself, so a buyer can go straight to monitors or tractors.
 *
 * Patterns run against diacritic-folded, lowercased text, so `racunar` matches
 * "računar", "Računara" and the Cyrillic "рачунар" alike.
 */

export interface ItemTag {
  id: string;
  label: string;
  group: string;
  pattern: RegExp;
}

const G = {
  it: 'Računari i IT oprema',
  home: 'Kućanski aparati',
  furniture: 'Namještaj',
  vehicles: 'Vozila',
  machines: 'Mašine i alati',
  agri: 'Poljoprivreda',
  hospitality: 'Ugostiteljstvo i trgovina',
  property: 'Nekretnine',
  other: 'Ostalo',
} as const;

/**
 * Order matters: the first match wins for the "primary" tag, so the more
 * specific entries are listed before the generic catch-alls in their group.
 */
export const ITEM_TAGS: ItemTag[] = [
  // ── IT ────────────────────────────────────────────────────────────────────
  { id: 'monitor', label: 'Monitori', group: G.it, pattern: /\bmonitor|ekran\b/ },
  { id: 'laptop', label: 'Laptopi', group: G.it, pattern: /\blaptop|notebook|prijenosn\w* racunar/ },
  { id: 'racunar', label: 'Računari', group: G.it, pattern: /\bracunar|kompjuter|\bpc\b|desktop|racunarsk\w+ (?:oprem|konfigur)/ },
  { id: 'printer', label: 'Štampači i skeneri', group: G.it, pattern: /\bstampac|printer|skener|scanner|fotokopir|kopir aparat/ },
  { id: 'server', label: 'Serveri i mreža', group: G.it, pattern: /\bserver\b|switch\b|router|ruter|\bups\b|rack\b/ },
  { id: 'telefon', label: 'Telefoni', group: G.it, pattern: /\btelefon|mobitel|mobiln\w+ (?:aparat|telefon)|smartphone/ },
  { id: 'tv', label: 'Televizori', group: G.it, pattern: /\btelevizor|\btv\b|lcd\b|led tv|plazma/ },
  { id: 'audio', label: 'Audio i video', group: G.it, pattern: /\bzvucnik|pojacalo|mikrofon|kamera|projektor|dvd\b|radio aparat/ },

  // ── Household ─────────────────────────────────────────────────────────────
  { id: 'frizider', label: 'Frižideri i zamrzivači', group: G.home, pattern: /\bfrizider|zamrziva|rashladn\w+ (?:vitrin|uredaj|komor)/ },
  { id: 'vesmasina', label: 'Veš mašine i sudopere', group: G.home, pattern: /\bves ?masin|masina za (?:pranje|sude)|sudoper|susilica/ },
  { id: 'sporet', label: 'Šporeti i pećnice', group: G.home, pattern: /\bsporet|pecnic|rerna|mikrovaln|stednjak/ },
  { id: 'klima', label: 'Klima uređaji i grijanje', group: G.home, pattern: /\bklima ?(?:uredaj|)|klimatiza|grijalic|radijator|pec\b|kotao|termoakumul/ },

  // ── Furniture ─────────────────────────────────────────────────────────────
  { id: 'kancelarijski', label: 'Kancelarijski namještaj', group: G.furniture, pattern: /\bradni ?sto|kancelarijsk\w+ (?:sto|stolic|namjesta|ormar)|pisaci sto/ },
  { id: 'stolice', label: 'Stolice i fotelje', group: G.furniture, pattern: /\bstolic|fotelj|barsk\w+ stolic/ },
  { id: 'ormari', label: 'Ormari i police', group: G.furniture, pattern: /\bormar|orman|\bpolic[aeu]\b|\bpolice\b|\bpolicama\b|regal|vitrin|komod/ },
  { id: 'kreveti', label: 'Kreveti i ležajevi', group: G.furniture, pattern: /\bkrevet|lezaj|madrac|kauc|ugaon\w+ garnitur|garnitur\w* za sjedenje|trosjed|dvosjed|sjedec\w+ garnitur/ },
  { id: 'stolovi', label: 'Stolovi', group: G.furniture, pattern: /\bstolov|\bstol\b|\bstolic?a\b|radni sto\b|pisaci sto\b|\bsto\s+za\b|trpezarijsk/ },

  // ── Vehicles ──────────────────────────────────────────────────────────────
  { id: 'putnicko', label: 'Putnička vozila', group: G.vehicles, pattern: /\bputnick\w+ (?:motorn\w+ )?vozil|\bpmv\b|osobn\w+ (?:automobil|vozil)|\bautomobil/ },
  { id: 'teretno', label: 'Teretna vozila i kamioni', group: G.vehicles, pattern: /\bkamion|teretn\w+ (?:motorn\w+ )?vozil|\btmv\b|kiper|cisterna|sleper|tegljac/ },
  { id: 'kombi', label: 'Kombi vozila', group: G.vehicles, pattern: /\bkombi|minibus|furgon|dostavn\w+ vozil/ },
  { id: 'autobus', label: 'Autobusi', group: G.vehicles, pattern: /\bautobus/ },
  { id: 'motocikl', label: 'Motocikli i skuteri', group: G.vehicles, pattern: /\bmotocikl|\bmoped|skuter|motorn\w+ bicikl|\bquad\b|atv\b/ },
  { id: 'bicikl', label: 'Bicikli', group: G.vehicles, pattern: /\bbicikl(?!o)/ },
  { id: 'prikolica', label: 'Prikolice', group: G.vehicles, pattern: /\bprikolic|poluprikolic|auto ?prikolic/ },
  { id: 'plovila', label: 'Plovila', group: G.vehicles, pattern: /\bcamac|plovil|brodic|jahta|glisser|gliser/ },

  // ── Machines & tools ──────────────────────────────────────────────────────
  { id: 'viljuskar', label: 'Viljuškari', group: G.machines, pattern: /\bviljuskar|forklift/ },
  { id: 'gradjevinske', label: 'Građevinske mašine', group: G.machines, pattern: /\bbager|utovariva|rovokopac|valjak|mjesalic|mijesalic|kompresor|skela|dizalic|kran\b/ },
  { id: 'drvo', label: 'Mašine za drvo', group: G.machines, pattern: /\bcirkular|tracn\w+ pil|blanjalic|glodalic za drvo|motorn\w+ (?:testera|pila)|cepac/ },
  { id: 'metal', label: 'Mašine za metal', group: G.machines, pattern: /\bstrug\b|tokarski|glodalic|brusilic|presa\b|makaze za lim|varilic|aparat za varenje|cnc\b|automat\b/ },
  { id: 'tekstil', label: 'Tekstilne mašine', group: G.machines, pattern: /\bsivac\w+ masin|masina za sivenje|overlok|stepalic|pletac/ },
  { id: 'alat', label: 'Alati', group: G.machines, pattern: /\bbusilic|brusilic|alat\b|rucni alat|kljuc(?:evi)?\b|set alata|aparat za/ },
  { id: 'agregat', label: 'Agregati i pumpe', group: G.machines, pattern: /\bagregat|generator\b|pumpa\b|motorna pumpa|hidrofor/ },

  // ── Agriculture ───────────────────────────────────────────────────────────
  { id: 'traktor', label: 'Traktori', group: G.agri, pattern: /\btraktor|traktorsk/ },
  { id: 'poljoprivredna', label: 'Poljoprivredni priključci', group: G.agri, pattern: /\bplug\b|kosacic|kosaćic|balirk|rolo presa|sijacic|freza\b|drljac|rasipac|prskalic|kombajn|berac/ },
  { id: 'stoka', label: 'Stoka', group: G.agri, pattern: /\bkrav[aeiou]\b|\bjunad|\bjunic|\btele\b|\bovc[aeu]\b|\bovaca\b|\bkoz[aeu]\b|kozj|svinj|\bstoka\b|\bstoke\b|\bgrlo\b|\bkonj\b|perad|\bpcel/ },

  // ── Hospitality / retail ──────────────────────────────────────────────────
  { id: 'ugostiteljska', label: 'Ugostiteljska oprema', group: G.hospitality, pattern: /\bsank\b|aparat za kafu|espresso|tocionik|rostilj|friteza|pekar\w+ pec|ugostiteljsk/ },
  { id: 'trgovacka', label: 'Trgovačka oprema i roba', group: G.hospitality, pattern: /\bfiskaln|\bkasa\b|\bvaga\b|\bvage\b|police za robu|\bzalih\w|\bartikl|trgovack\w+ (?:oprem|rob)/ },

  // ── Property ──────────────────────────────────────────────────────────────
  { id: 'stan', label: 'Stanovi', group: G.property, pattern: /\bstan\b|stana\b|stanu\b|apartman|etazn\w+ vlasnist/ },
  { id: 'kuca', label: 'Kuće', group: G.property, pattern: /\bkuca\b|kuce\b|kucu\b|stambena zgrada|stambeni objek|porodicn\w+ (?:kuc|stambe)/ },
  { id: 'poslovni', label: 'Poslovni prostori', group: G.property, pattern: /\bposlovn\w+ (?:prostor|objek|zgrad)|kancelarijsk\w+ prostor|hala\b|magacin|skladist/ },
  { id: 'garaza', label: 'Garaže', group: G.property, pattern: /\bgaraz/ },
  { id: 'zemljiste', label: 'Zemljišta i parcele', group: G.property, pattern: /\bzemljist|parcel|njiv\w|livad|pasnjak|voćnjak|vocnjak|sum\w+ \d|gradilist|oranic/ },
];

const PRIMARY_ORDER = new Map(ITEM_TAGS.map((t, i) => [t.id, i]));

/**
 * Tags present in the notice. Returns every match, because a single lot often
 * mixes categories ("računar, monitor i štampač").
 */
export function tagItems(
  title: string | null | undefined,
  description: string | null | undefined,
  body?: string | null,
): string[] {
  const primary = fold([title, description].filter(Boolean).join('\n'));
  let hits = match(primary);

  // The notice body is full of stock legal phrasing, so only reach for it when
  // the description gave us nothing to work with.
  if (!hits.length && body) hits = match(fold(body));

  return hits.sort((a, b) => (PRIMARY_ORDER.get(a) ?? 0) - (PRIMARY_ORDER.get(b) ?? 0));
}

function match(text: string): string[] {
  if (!text) return [];
  return ITEM_TAGS.filter((t) => t.pattern.test(text)).map((t) => t.id);
}

export const TAG_BY_ID = new Map(ITEM_TAGS.map((t) => [t.id, t]));

export const TAG_GROUPS = [...new Set(ITEM_TAGS.map((t) => t.group))];

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { ITEM_TAGS } from './items.ts';
import { PROMPT_VERSION } from '../version.ts';
import { DEFAULT_MODEL, env } from '../config.ts';

/**
 * LLM-first extraction: hand the model the whole notice, get every field back
 * in one structured response.
 *
 * Why this rather than more patterns. These notices are written by dozens of
 * courts with no shared template, so rule-based extraction is an open-ended
 * chase: each new phrasing needs another pattern, and a missed one fails
 * *silently* - it yields plausible-looking wrong output. A model reads the
 * document the way a person would and handles phrasings nobody enumerated.
 *
 * What stays deterministic, on purpose:
 *   - **Redaction** runs on the model's output, never instead of it. A model
 *     can be told not to emit debtor names; it cannot be relied on for that,
 *     and this is the one field with legal consequences.
 *   - **Validation** (zod + scripts/verify.ts) gates everything.
 *   - **Rules** remain as the fallback path when no API key is configured.
 *
 * Determinism comes from caching: results are keyed by a hash of the document
 * text plus PROMPT_VERSION, so the same input always yields the same committed
 * output and re-runs cost nothing. Bump PROMPT_VERSION to force re-analysis.
 */
// `env()` rather than `??` throughout: a blank value must fall back, not be
// used. See the note on env() in ../config.ts - `Number('')` is 0, so a blank
// LLM_CONCURRENCY would hand pLimit a concurrency of zero.
const MODEL = env('LLM_MODEL', DEFAULT_MODEL);
const CONCURRENCY = Number(env('LLM_CONCURRENCY', '4'));
const MAX_CALLS = Number(env('LLM_MAX_CALLS', '2000'));
const CACHE_DIR = '.cache/llm';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export function llmEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

const TAG_IDS = ITEM_TAGS.map((t) => t.id);

export interface Analysis {
  headline: string | null;
  itemDescription: string | null;
  itemTags: string[];
  caseNumber: string | null;
  appraisedValue: number | null;
  startingPrice: number | null;
  deposit: number | null;
  saleTime: string | null;
  auctionRound: 'prvo' | 'drugo' | 'trece' | 'nepoznato';
  saleMethod:
    | 'usmeno-javno-nadmetanje'
    | 'neposredna-pogodba'
    | 'prikupljanje-ponuda'
    | 'nepoznato';
  auctionLocation: string | null;
  municipality: string | null;
  cadastral: { kc: string[]; zkUlozak: string[]; ko: string[] } | null;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: {
      type: ['string', 'null'],
      description:
        'Kratak naslov, najviše 70 znakova, kao naslov oglasa. Npr. "Stan 62 m², Novo Sarajevo" ili "Traktor IMT 539, prikolica". Bez cijena, bez broja predmeta, bez imena osoba.',
    },
    itemDescription: {
      type: ['string', 'null'],
      description:
        'Šta se prodaje, do 300 znakova, stavke odvojene zarezom. Bez procesnog teksta o ročištu.',
    },
    itemTags: { type: 'array', items: { type: 'string', enum: TAG_IDS } },
    caseNumber: { type: ['string', 'null'], description: 'Npr. "65 0 Ip 1177038 25 Ip"' },
    appraisedValue: { type: ['number', 'null'] },
    startingPrice: { type: ['number', 'null'] },
    deposit: { type: ['number', 'null'] },
    saleTime: { type: ['string', 'null'], description: 'HH:mm' },
    auctionRound: { type: 'string', enum: ['prvo', 'drugo', 'trece', 'nepoznato'] },
    saleMethod: {
      type: 'string',
      enum: ['usmeno-javno-nadmetanje', 'neposredna-pogodba', 'prikupljanje-ponuda', 'nepoznato'],
    },
    auctionLocation: {
      type: ['string', 'null'],
      description: 'Zgrada i soba suda gdje se održava ročište. Samo sud, ne adresa izvršenika.',
    },
    municipality: {
      type: ['string', 'null'],
      description: 'Općina gdje se predmet nalazi, u nominativu (npr. "Sarajevo"). Bez ulice.',
    },
    // The only fields here that used to carry no description, and the only
    // ones the model answered out of the document's heading: "PRVOJ PRODAJI"
    // was reported as a cadastral municipality 40 times. Junk is filtered
    // downstream regardless (extract/cadastral.ts), but a described field is
    // the cheaper place to stop it.
    cadastral: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        kc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Brojevi katastarskih čestica, samo cifre (npr. "2933/1"). Prazno ako ih nema.',
        },
        zkUlozak: {
          type: 'array',
          items: { type: 'string' },
          description: 'Brojevi zemljišnoknjižnih uložaka, samo cifre (npr. "565"). Prazno ako ih nema.',
        },
        ko: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Nazivi katastarskih općina iza oznake "k.o." - imena mjesta (npr. "Binježevo", "Dvorovi"). Nikada naslov ili tekst oglasa ("prvoj prodaji"), nikada kanton ili entitet. Prazno ako oznake "k.o." nema.',
        },
      },
      required: ['kc', 'zkUlozak', 'ko'],
    },
  },
  required: [
    'headline', 'itemDescription', 'itemTags', 'caseNumber', 'appraisedValue',
    'startingPrice', 'deposit', 'saleTime', 'auctionRound', 'saleMethod',
    'auctionLocation', 'municipality', 'cadastral',
  ],
} as const;

const SYSTEM = `Ti si precizan ekstraktor podataka iz oglasa o sudskoj prodaji (izvršni postupak) u Bosni i Hercegovini. Vrati isključivo JSON prema shemi.

CIJENE (u KM, vrati čist broj bez separatora hiljada):
- appraisedValue = utvrđena / procijenjena / tržišna vrijednost predmeta prodaje.
- startingPrice = najniža ili početna cijena po kojoj se smije prodati na OVOM ročištu ("ne može se prodati ispod...").
- deposit = osiguranje / kapara / jemstvo / učešće koje uplaćuje ponuđač (u pravilu 1/10 vrijednosti, najviše 10.000 KM).
- Ako se prodaje više stvari, appraisedValue je ZBIR njihovih vrijednosti.
- Ako je najniža cijena data kao razlomak ("ispod 1/2 utvrđene vrijednosti"), izračunaj iznos.
- PAŽNJA: iznos duga koji se naplaćuje ("radi naplate duga", "v.sp.", "novčano potraživanje") NIJE cijena. Ignoriši ga.
- startingPrice nikada ne smije biti veći od appraisedValue.

OPIS:
- headline: kratak, čitljiv naslov kao na oglasniku. Za nekretnine navedi vrstu i površinu ("Stan 62 m², Ilidža", "Oranica 1.217 m², Hrasnica"). Za pokretnine navedi glavne stavke ("Ugaona garnitura, LCD TV, trpezarijski sto").
- itemDescription: nabroj stavke; NE prepisuj procesni tekst o ročištu, rokovima, žalbama ili zakonskim članovima.
- itemTags: biraj samo iz ponuđene liste, koliko god ih odgovara.

PRIVATNOST - obavezno:
- NIKADA ne navodi ime, prezime ni adresu izvršenika, tražioca izvršenja ili bilo koje fizičke osobe, ni u jednom polju.
- Naziv firme (d.o.o., a.d., d.d.) i naziv radnje pod navodnicima smiješ zadržati.
- auctionLocation je isključivo sud (zgrada, soba). Nikad kućna adresa.

Ako podatak ne postoji u tekstu, vrati null. Nemoj pogađati ni izmišljati.`;

function cacheKey(text: string): string {
  return createHash('sha256').update(`${PROMPT_VERSION}\0${MODEL}\0${text}`).digest('hex');
}

async function readCache(key: string): Promise<Analysis | null> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), 'utf8')) as Analysis;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: Analysis): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value), 'utf8');
}

async function callModel(text: string): Promise<Analysis | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/omznc/aukcije',
      'X-Title': 'aukcije-bot',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.slice(0, 16_000) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'sudska_prodaja', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    console.warn(`  ! OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return null;
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (body.error) {
    console.warn(`  ! OpenRouter: ${body.error.message}`);
    return null;
  }
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) return null;

  const parse = (s: string) => {
    try {
      return JSON.parse(s) as Analysis;
    } catch {
      return null;
    }
  };
  return parse(raw) ?? parse(raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? '');
}

/**
 * Analyse many notices, reusing cached results. Returns a map keyed by listing
 * id; ids absent from the map fall back to rule-based extraction.
 */
export async function analyzeAll(
  texts: Map<string, string>,
): Promise<Map<string, Analysis>> {
  const out = new Map<string, Analysis>();
  const pending: Array<[string, string, string]> = []; // id, text, cacheKey

  for (const [id, text] of texts) {
    if (!text || text.replace(/\s/g, '').length < 80) continue;
    const key = cacheKey(text);
    const hit = await readCache(key);
    if (hit) out.set(id, hit);
    else pending.push([id, text, key]);
  }

  console.log(`  ${out.size} cached, ${pending.length} to analyse via ${MODEL}`);
  const budget = pending.slice(0, MAX_CALLS);
  if (budget.length < pending.length) {
    console.log(`  capped at ${MAX_CALLS}; ${pending.length - budget.length} deferred to next run`);
  }

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let failed = 0;

  await Promise.all(
    budget.map(([id, text, key]) =>
      limit(async () => {
        const result = await callModel(text).catch(() => null);
        if (!result) {
          failed++;
        } else {
          out.set(id, result);
          await writeCache(key, result);
        }
        if (++done % 100 === 0) console.log(`    ${done}/${budget.length}`);
      }),
    ),
  );

  console.log(`  analysed ${done - failed}${failed ? `, ${failed} failed` : ''}`);

  // Refuse to return a half-empty result when the model call is systemically
  // broken. Every id missing here falls back to rule-based extraction, which
  // succeeds quietly at lower quality - so a bad key, a model that rejects the
  // schema, or an OpenRouter outage would otherwise produce a complete-looking
  // dataset that then gets committed and published. That is not hypothetical:
  // an empty LLM_MODEL sent 295 notices down the fallback path and the run
  // committed the result.
  //
  // Individual failures are ordinary and still tolerated; only a rate that says
  // "the call itself is broken" aborts the run.
  if (failed >= 3 && failed / budget.length > 0.25) {
    throw new Error(
      `${failed} of ${budget.length} model calls failed (${Math.round(
        (failed / budget.length) * 100,
      )}%) - refusing to publish a dataset that quietly fell back to rules. ` +
        `Check OPENROUTER_API_KEY and that "${MODEL}" exists and supports json_schema response format.`,
    );
  }
  return out;
}

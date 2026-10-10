/**
 * OCR for scanned PDFs by handing the file to a model.
 *
 * The alternative is poppler + tesseract, which means a system install in every
 * environment that runs the scraper, and a rasterise-then-recognise pipeline to
 * maintain. Since the project already talks to a model, sending the PDF itself
 * is both simpler and better at Bosnian/Croatian/Serbian - including the
 * Cyrillic notices from Republika Srpska courts, where tesseract needs the
 * right language pack selected up front to stand a chance.
 *
 * Claude accepts a PDF as a `document` block and reads each page as an image,
 * so nothing has to be installed locally.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL, env } from '../config.ts';
import { claude, claudeEnabled, responseText } from './claude.ts';

const CACHE_DIR = '.cache/ocr';

/** Vision-capable and cheap; override if the default is unavailable. */
const MODEL = env('OCR_MODEL', env('LLM_MODEL', DEFAULT_MODEL));

/**
 * Haiku costs five times more for a prompt above 100k tokens. A notice is a
 * few pages, so a larger PDF goes to the local OCR fallback.
 */
const MAX_INPUT_TOKENS = 100_000;

const PROMPT = `Ovo je skenirani sudski oglas o prodaji iz Bosne i Hercegovine.
Prepiši SAV tekst iz dokumenta, tačno kako piše, zadržavajući redoslijed redova i sve iznose i datume.
Zadrži originalno pismo (latinicu ili ćirilicu) i sve dijakritike (č, ć, ž, š, đ).
Ne prevodi, ne sažimaj i ne komentariši - vrati samo prepisani tekst.`;

export const visionOcrAvailable = claudeEnabled;

async function cached(key: string): Promise<string | null> {
  try {
    return await readFile(join(CACHE_DIR, `${key}.txt`), 'utf8');
  } catch {
    return null;
  }
}

async function transcribe(buf: Buffer): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
        },
        { type: 'text', text: PROMPT },
      ],
    },
  ];

  const { input_tokens } = await claude().messages.countTokens({ model: MODEL, messages });
  if (input_tokens > MAX_INPUT_TOKENS) {
    console.warn(`  ! vision OCR: ${input_tokens} input tokens, over ${MAX_INPUT_TOKENS}; skipped`);
    return '';
  }

  const res = await claude().messages.create({
    model: MODEL,
    max_tokens: 16_000,
    messages,
    output_config: { effort: 'low' },
  });
  if (res.stop_reason !== 'end_turn') {
    console.warn(`  ! vision OCR stopped with ${res.stop_reason}`);
    return '';
  }
  return responseText(res).trim();
}

/**
 * Transcribe a scanned PDF. Returns an empty string when unavailable or on
 * failure, so callers can fall back without special-casing.
 */
export async function ocrPdfWithModel(buf: Buffer): Promise<string> {
  if (!visionOcrAvailable()) return '';

  const key = createHash('sha256').update(buf).update(`|${MODEL}`).digest('hex');
  const hit = await cached(key);
  if (hit !== null) return hit;

  try {
    const text = await transcribe(buf);
    if (text) {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(join(CACHE_DIR, `${key}.txt`), text, 'utf8');
    }
    return text;
  } catch (err) {
    console.warn(`  ! vision OCR failed: ${(err as Error).message}`);
    return '';
  }
}

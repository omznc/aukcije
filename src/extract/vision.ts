/**
 * OCR for scanned PDFs by handing the file to a model.
 *
 * The alternative is poppler + tesseract, which means a system install in every
 * environment that runs the scraper, and a rasterise-then-recognise pipeline to
 * maintain. Since the project already talks to a model, sending the PDF itself
 * is both simpler and better at Bosnian/Croatian/Serbian — including the
 * Cyrillic notices from Republika Srpska courts, where tesseract needs the
 * right language pack selected up front to stand a chance.
 *
 * OpenRouter's `file` content part accepts a PDF directly and its `file-parser`
 * plugin does the extraction, so nothing has to be installed locally.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const CACHE_DIR = '.cache/ocr';

/** Vision-capable and cheap; override if the default is unavailable. */
const MODEL = process.env.OCR_MODEL ?? process.env.LLM_MODEL ?? 'google/gemini-2.5-flash-lite';

/**
 * `mistral-ocr` handles scanned pages; `pdf-text` only lifts an existing text
 * layer, which by definition these files do not have.
 */
const ENGINE = process.env.OCR_ENGINE ?? 'mistral-ocr';

const PROMPT = `Ovo je skenirani sudski oglas o prodaji iz Bosne i Hercegovine.
Prepiši SAV tekst iz dokumenta, tačno kako piše, zadržavajući redoslijed redova i sve iznose i datume.
Zadrži originalno pismo (latinicu ili ćirilicu) i sve dijakritike (č, ć, ž, š, đ).
Ne prevodi, ne sažimaj i ne komentariši — vrati samo prepisani tekst.`;

export function visionOcrAvailable(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

async function cached(key: string): Promise<string | null> {
  try {
    return await readFile(join(CACHE_DIR, `${key}.txt`), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Transcribe a scanned PDF. Returns an empty string when unavailable or on
 * failure, so callers can fall back without special-casing.
 */
export async function ocrPdfWithModel(buf: Buffer): Promise<string> {
  if (!visionOcrAvailable()) return '';

  const key = createHash('sha256').update(buf).update(`|${MODEL}|${ENGINE}`).digest('hex');
  const hit = await cached(key);
  if (hit !== null) return hit;

  try {
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
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              {
                type: 'file',
                file: {
                  filename: 'oglas.pdf',
                  file_data: `data:application/pdf;base64,${buf.toString('base64')}`,
                },
              },
            ],
          },
        ],
        plugins: [{ id: 'file-parser', pdf: { engine: ENGINE } }],
      }),
    });

    if (!res.ok) {
      console.warn(`  ! vision OCR ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return '';
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (body.error) {
      console.warn(`  ! vision OCR: ${body.error.message}`);
      return '';
    }

    const text = (body.choices?.[0]?.message?.content ?? '').trim();
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

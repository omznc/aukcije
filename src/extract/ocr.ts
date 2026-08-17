import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cleanWhitespace } from '../lib/text.ts';

const run = promisify(execFile);

/**
 * OCR for scanned (image-only) PDFs, which are a real minority of attachments -
 * mostly older Republika Srpska notices.
 *
 * We shell out to poppler + tesseract rather than using the WASM build: on a CI
 * runner both are a one-line apt install, they are markedly faster for batch
 * work, and this keeps the npm dependency tree free of native canvas bindings.
 *
 * Language packs matter here. `srp` is *Cyrillic*; Latin-script Bosnian and
 * Croatian need `bos`/`hrv`, and Serbian Latin needs `srp_latn`. Loading them
 * together lets one pass handle both scripts.
 */
const LANGS = 'bos+hrv+srp+srp_latn';

let availability: Promise<boolean> | null = null;

async function has(cmd: string): Promise<boolean> {
  try {
    await run(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** Cached so we probe the environment once per process, not once per document. */
export function ocrAvailable(): Promise<boolean> {
  availability ??= (async () => {
    const [poppler, tess] = await Promise.all([has('pdftoppm'), has('tesseract')]);
    if (!poppler || !tess) {
      console.warn(
        `  ! OCR unavailable (pdftoppm=${poppler}, tesseract=${tess}); scanned PDFs will be skipped`,
      );
    }
    return poppler && tess;
  })();
  return availability;
}

/** Which of the wanted language packs this machine actually has. */
async function installedLangs(): Promise<string> {
  try {
    const { stdout } = await run('tesseract', ['--list-langs']);
    const have = new Set(stdout.split('\n').map((l) => l.trim()));
    const wanted = LANGS.split('+').filter((l) => have.has(l));
    return wanted.length ? wanted.join('+') : 'eng';
  } catch {
    return 'eng';
  }
}

export async function ocrPdf(buf: Buffer, maxPages = 8): Promise<string> {
  if (!(await ocrAvailable())) return '';

  const dir = await mkdtemp(join(tmpdir(), 'aukcije-ocr-'));
  try {
    const pdfPath = join(dir, 'in.pdf');
    await writeFile(pdfPath, buf);

    // 300 DPI greyscale is the sweet spot for these mostly-typewritten scans.
    await run('pdftoppm', [
      '-png', '-r', '300', '-gray',
      '-f', '1', '-l', String(maxPages),
      pdfPath, join(dir, 'page'),
    ]);

    const langs = await installedLangs();
    const pages: string[] = [];
    for (let i = 1; i <= maxPages; i++) {
      // pdftoppm zero-pads the index to the width of the page count.
      const candidates = [`page-${i}.png`, `page-${String(i).padStart(2, '0')}.png`];
      let img: string | null = null;
      for (const c of candidates) {
        try {
          await readFile(join(dir, c));
          img = join(dir, c);
          break;
        } catch {}
      }
      if (!img) break;
      const out = join(dir, `out-${i}`);
      await run('tesseract', [img, out, '-l', langs, '--psm', '6']);
      pages.push(await readFile(`${out}.txt`, 'utf8'));
    }
    return fixOcrArtifacts(cleanWhitespace(pages.join('\n')));
  } catch (err) {
    console.warn(`  ! OCR failed: ${(err as Error).message}`);
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Repair the handful of recurring OCR mistakes in this corpus. Restricted to
 * fixed legal vocabulary so we never "correct" a party name or an amount.
 */
export function fixOcrArtifacts(text: string): string {
  return text
    // "KM" is the single most-mangled token in these scans.
    .replace(/\bK[lI]v[lI]?\b/g, 'KM')
    .replace(/\bK[MNH]\b/g, 'KM')
    .replace(/(\d)[ ,.]00\s*[KX][MN]\b/g, '$1,00 KM')
    .replace(/\bro[cč]i[sš]t[ea]\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Ročište' : 'ročište'))
    .replace(/\bnadmetanj[ea]\b/gi, (m) => m.toLowerCase())
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"');
}

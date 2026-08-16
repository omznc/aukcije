/**
 * Text normalisation for Bosnian/Croatian/Serbian court notices.
 *
 * Two quirks drive everything here:
 *  1. Notice bodies are pasted out of Microsoft Word, so they carry huge
 *     `<style>` blocks and `<!--[if gte mso 9]>` conditional comments. Naive
 *     tag-stripping leaks CSS into the text and poisons downstream regexes.
 *  2. Republika Srpska courts publish in Cyrillic. Matching has to work across
 *     both scripts, so we transliterate for comparison purposes only.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
};

/** Convert Cyrillic to Latin, preserving case of the first letter. */
export function toLatin(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN[lower];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }
  return out;
}

/** Strip diacritics so "Živinice" matches a query of "zivinice". */
export function fold(input: string): string {
  return toLatin(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", shy: '',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+|#\d+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * HTML → plain text, aggressively removing the Word cruft described above.
 * Block-level tags become newlines so paragraph structure survives for the
 * field extractor.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Word's conditional comments carry a whole XML document; kill comments first.
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(style|script|xml)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Unclosed <style> at end of document (seen in practice).
  s = s.replace(/<style\b[\s\S]*$/i, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, '\t');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return cleanWhitespace(s);
}

export function cleanWhitespace(s: string): string {
  return s
    .replace(/ /g, ' ')
    // Dotted leaders ("Kosačica ........ 500,00 KM") arrive with their dots split
    // across tags or spaced apart; collapse them so they remain recognisable as a
    // price-list separator rather than sentence punctuation.
    .replace(/(?:\.[ \t\u00a0]*){4,}/g, '....')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .normalize('NFC')
    .trim();
}

/**
 * Residual Word CSS sometimes survives as plain text (e.g. `mso-para-margin:0cm;`).
 * Drop lines that look like stylesheet declarations rather than prose.
 */
export function stripStyleNoise(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      if (/mso-|font-family:|panose-1:|@page|WordSection|text-underline/i.test(line)) return false;
      const colons = (line.match(/:/g) ?? []).length;
      const semis = (line.match(/;/g) ?? []).length;
      return !(colons >= 3 && semis >= 3);
    })
    .join('\n');
}

export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

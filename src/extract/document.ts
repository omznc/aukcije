import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { extractText, getDocumentProxy } from 'unpdf';
import { cleanWhitespace, stripStyleNoise } from '../lib/text.ts';

export type DocKind = 'pdf' | 'docx' | 'doc' | 'unknown';

export interface ExtractedDoc {
  kind: DocKind;
  text: string;
  sha256: string;
  /** True when the file parsed but yielded no text — i.e. a scanned image PDF. */
  needsOcr: boolean;
}

/**
 * Sniff by magic bytes rather than trusting `tipDoc`: the API serves every
 * attachment as application/octet-stream and the declared type has been wrong
 * in practice (e.g. a .doc extension on a real OOXML file).
 */
export function sniffKind(buf: Buffer): DocKind {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // OOXML is a zip; legacy Word is an OLE2 compound file.
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'docx';
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    return 'doc';
  return 'unknown';
}

async function fromPdf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : text;
}

async function fromDocx(buf: Buffer): Promise<string> {
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

async function fromDoc(buf: Buffer): Promise<string> {
  const doc = await new WordExtractor().extract(buf);
  // Notices occasionally put the operative text in headers/footers.
  return [doc.getBody(), doc.getHeaders(), doc.getFootnotes()].filter(Boolean).join('\n');
}

export async function extractDocument(buf: Buffer): Promise<ExtractedDoc> {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const kind = sniffKind(buf);
  let text = '';

  try {
    if (kind === 'pdf') text = await fromPdf(buf);
    else if (kind === 'docx') text = await fromDocx(buf);
    else if (kind === 'doc') text = await fromDoc(buf);
  } catch (err) {
    console.warn(`  ! ${kind} extraction failed: ${(err as Error).message}`);
  }

  text = stripStyleNoise(cleanWhitespace(text));
  // A real notice is never this short; treat near-empty PDFs as scans.
  const needsOcr = kind === 'pdf' && text.replace(/\s/g, '').length < 120;
  return { kind, text, sha256, needsOcr };
}

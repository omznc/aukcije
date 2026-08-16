import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '../config.ts';

/**
 * On-disk cache of downloaded attachments.
 *
 * Two reasons this exists: it keeps `--full` re-extraction runs from hammering
 * the portal when only our parsing changed, and it lets us re-derive the whole
 * dataset offline after a rule change. It is deliberately outside `data/` and
 * git-ignored, because the source documents contain debtor personal data that
 * we do not want in a public repository's history.
 */
export async function cachedDownload(
  docId: number,
  fetcher: () => Promise<Buffer>,
): Promise<Buffer> {
  const path = join(PATHS.documents, String(docId));
  try {
    return await readFile(path);
  } catch {
    const buf = await fetcher();
    await mkdir(PATHS.documents, { recursive: true });
    await writeFile(path, buf);
    return buf;
  }
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

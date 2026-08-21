/**
 * Version stamps for everything that shapes a stored listing.
 *
 * The scraper reuses previously extracted listings so a routine run does not
 * re-download the whole archive. Without a stamp, that reuse is a trap: a fix
 * to redaction or to the prompt would only ever reach *new* notices, and the
 * records already in `data/` would keep whatever they were built with. A
 * privacy fix that silently does not apply to existing rows is the exact
 * failure mode this guards against.
 *
 * Bump the relevant number whenever a change should invalidate stored output:
 *
 *   PROMPT_VERSION     the model prompt or its response schema
 *   REDACTION_VERSION  anything in src/redact.ts
 *   RULES_VERSION      rule-based extraction (fields / describe / items)
 *
 * A listing whose `extraction.pipelineVersion` differs from PIPELINE_VERSION is
 * rebuilt on the next run. The LLM cache is keyed separately by document hash,
 * so rebuilding is usually free - it costs an API call only when PROMPT_VERSION
 * itself changed.
 */
export const PROMPT_VERSION = 3;
export const REDACTION_VERSION = 3;
export const RULES_VERSION = 8;

export const PIPELINE_VERSION = `${PROMPT_VERSION}.${REDACTION_VERSION}.${RULES_VERSION}`;

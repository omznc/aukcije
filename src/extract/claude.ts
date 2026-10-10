import Anthropic from '@anthropic-ai/sdk';

/**
 * The shared Claude client for extraction and OCR.
 *
 * The client is made on first use. A run without ANTHROPIC_API_KEY never
 * calls the model, so it must not need a client.
 */
let client: Anthropic | undefined;

export function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Join the text blocks of a response. Thinking blocks are skipped. */
export function responseText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

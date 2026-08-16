declare module 'word-extractor' {
  class Document {
    getBody(): string;
    getHeaders(): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getTextboxes(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }
}

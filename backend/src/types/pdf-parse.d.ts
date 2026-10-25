declare module 'pdf-parse' {
  interface PDFParseOptions {
    max?: number;
  }

  interface PDFParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(data: Buffer, options?: PDFParseOptions): Promise<PDFParseResult>;
  export default pdfParse;
}

import { PDFParse } from "pdf-parse"; // named import, not default

export async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer }); // buffer = Buffer from fs.readFile / upload
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy(); // frees the pdf.js worker
  }
}

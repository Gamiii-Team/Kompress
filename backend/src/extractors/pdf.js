import pdfParse from "pdf-parse";

async function extractPdf(buffer) {
  try {
    const data = await pdfParse(buffer);
    // Basic cleanup: remove excessive whitespace
    return data.text.replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("PDF extraction failed:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

module.exports = { extractPdf };

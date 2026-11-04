import mammoth from "mammoth";

async function extractDocx(buffer) {
  try {
    // extractRawText ignores formatting and just gives us the plain text
    const result = await mammoth.extractRawText({ buffer });
    return result.value.replace(/\s+/g, " ").trim();
  } catch (error) {
    console.error("DOCX extraction failed:", error);
    throw new Error("Failed to extract text from DOCX");
  }
}

module.exports = { extractDocx };

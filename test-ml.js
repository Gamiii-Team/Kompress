// test-ml.js
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import adapter from "./backend/src/llm/adapter.js";
import { extractPdf } from "./backend/src/extractors/pdf.js";

dotenv.config();

async function test() {
  console.log("🚀 Starting ML Pipeline MVP Test...\n");

  // --- TEST 1: Text Extraction & Compression (Gemini) ---
  console.log("1️⃣ Testing Text Extraction & Gemini Compression...");
  try {
    // Use a small test PDF if you have one, or create a dummy one
    const testPdfPath = "test.pdf";
    if (fs.existsSync(testPdfPath)) {
      const pdfBuffer = fs.readFileSync(testPdfPath);
      const text = await extractPdf(pdfBuffer);
      console.log(`   ✅ Extracted ${text.length} characters.`);

      const compressed = await adapter.compressText(text);
      console.log("   ✅ Gemini Compression successful!");
      console.log(
        `   📝 Condensed preview: ${compressed.condensed.substring(0, 100)}...`,
      );
    } else {
      console.log(
        "   ⚠️  No test PDF found. Skipping extraction test. (Create backend/tests/fixtures/javascript.pdf)",
      );
      // Fallback test with raw text
      const compressed = await adapter.compressText(
        "This is a test document with a fact: The year is 2026.",
      );
      console.log("   ✅ Gemini Compression successful on raw text!");
    }
  } catch (error) {
    console.error("   ❌ Text test failed:", error.message);
  }

  console.log("\n2️⃣ Testing Modal Florence-2 Vision Endpoint...");
  try {
    // Create a tiny 1x1 pixel red PNG image in memory to test the endpoint
    const dummyImageBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );

    const visionResult = await adapter.describeImage(
      dummyImageBuffer,
      "<CAPTION>",
    );

    if (visionResult.success) {
      console.log("   ✅ Modal Florence-2 responded successfully!");
      console.log("   🖼️  Result:", JSON.stringify(visionResult.data));
    } else {
      console.error("   ❌ Modal vision test failed:", visionResult.error);
    }
  } catch (error) {
    console.error("   ❌ Vision test crashed:", error.message);
  }

  console.log("\n🎉 MVP ML Pipeline Test Complete!");
  console.log(
    "If both tests passed, your backend is fully ready to process documents.",
  );
}

test().catch(console.error);

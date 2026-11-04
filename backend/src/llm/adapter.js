import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";

// Initialize Gemini (Make sure GEMINI_API_KEY is in your .env)
const genAI = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || "YOUR_GEMINI_KEY",
);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    responseMimeType: "application/json", // Force JSON output
    temperature: 0, // Deterministic for fact preservation
  },
});

const MODAL_WEBHOOK_URL =
  process.env.MODAL_FLORENCE_URL ||
  "https://your-username--florence-2-vision-web-process.modal.run";

class LLMAdapter {
  /**
   * Compresses text into original/condensed layers with key facts.
   */
  async compressText(text) {
    const prompt = `
      You are a document compression engine. Your goal is to create a condensed version of the provided text while preserving 100% of the facts.

      Rules:
      1. Keep EVERY number, date, unit, name, definition, and cause-and-effect statement.
      2. Remove ONLY filler, repetition, and transitions.
      3. Add NOTHING that is not in the source text.

      Return strictly valid JSON with this exact schema:
      {
        "condensed": "string (the shortened text)",
        "key_facts": ["string (list of short, isolated factual statements)"],
        "terms": ["string (list of important named entities or defined terms)"]
      }

      Source Text:
      ${text.substring(0, 8000)} // Truncate to avoid exceeding token limits for MVP
    `;

    try {
      const result = await geminiModel.generateContent(prompt);
      const responseText = result.response.text();

      // Clean up markdown code blocks if Gemini adds them despite the mimeType config
      const cleanJson = responseText.replace(/```json\n?|\n?```/g, "").trim();
      return JSON.parse(cleanJson);
      // Note: In production, wrap this in a try/catch and implement the "fallback_to_original" logic from the build plan.
    } catch (error) {
      console.error("Gemini compression failed:", error);
      // MVP Fallback: Return original text if ML fails
      return {
        condensed: text,
        key_facts: [],
        terms: [],
        condensed_status: "fallback_to_original",
      };
    }
  }

  /**
   * Sends an image buffer to Modal Florence-2 for OCR or Captioning.
   */
  async describeImage(imageBuffer, task = "<OCR>") {
    try {
      const imageBase64 = imageBuffer.toString("base64");

      const response = await axios.post(
        MODAL_WEBHOOK_URL,
        {
          image_base64: imageBase64,
          task_prompt: task, // e.g., '<OCR>' or '<CAPTION>' or '<MORE_DETAILED_CAPTION>'
        },
        {
          timeout: 60000, // 60 seconds to account for Modal cold starts
        },
      );

      if (response.data && response.data.success) {
        return {
          success: true,
          data: response.data.result,
          model: "florence-2-base",
        };
      } else {
        throw new Error(response.data.error || "Modal processing failed");
      }
    } catch (error) {
      console.error("Modal vision processing failed:", error.message);
      return {
        success: false,
        error: error.message,
        model: "florence-2-base",
      };
    }
  }
}

module.exports = new LLMAdapter();

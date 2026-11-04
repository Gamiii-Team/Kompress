// Model Adapter — Mock (default) and Modal HTTP (production)
// Section 2 of plan. Adapter layer means api/worker don't know the provider.

const LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";

function mockCompress(chunkText, options = {}) {
  // Mock produces a structured JSON that passes schema validation
  return {
    original: chunkText,
    condensed:
      chunkText.slice(0, Math.min(500, chunkText.length)) +
      (chunkText.length > 500 ? "..." : ""),
    headings: [{ level: 1, text: options.subject || "Untitled" }],
    chunks: [
      {
        heading: options.subject || "Untitled",
        condensed_text: chunkText.slice(0, 400),
      },
    ],
    status: "done",
    model: "mock-v1",
    verified: true,
  };
}

async function modalCompress(chunkText, imageDescriptions = [], options = {}) {
  // Placeholder for Modal endpoint; not implemented in T1
  throw new Error(
    "Modal adapter not yet configured — set LLM_PROVIDER=mock for T1",
  );
}

async function adapt(chunkText, images = [], options = {}) {
  if (LLM_PROVIDER === "mock") {
    return mockCompress(chunkText, options);
  }
  return modalCompress(chunkText, images, options);
}

module.exports = { adapt, mockCompress, LLM_PROVIDER };

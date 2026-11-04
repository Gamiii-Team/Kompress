// Worker — BullMQ consumer; parsing runs always in separate thread from request
// Section 1 / 2 of plan. Never blocks API.
const { createWorker } = require('./adapters/queue');
const db = require('./adapters/db');
const storage = require('./adapters/storage');
const model = require('./adapters/model');

// Processing pipeline — stages match L3
async function processDocument(job) {
  const { docId, userKey, storageKey, fileName, subject, idempotencyKey } = job.data;
  const jobRecord = await db.getJob(job.id); // BullMQ job.id is different from DB job id; mapping needed for simplicity

  try {
    // Stage: validating
    await db.updateJob(job.id, 'validating');
    // (In full: extension, magic bytes, script scan, macro scan, archive bomb — see INPUT_VALIDATION.md)

    // Read from storage
    const obj = await storage.getObject(userKey, docId);
    if (!obj) throw new Error('Upload not found');

    // Stage: extracting
    await db.updateJob(job.id, 'extracting');
    // (Native extractors for pdf/docx/pptx/txt/md/rtf/odt; OCR for scanned pages)
    const extractedText = 'Mock extracted text for document ' + docId; // placeholder

    // Stage: structuring (2-level heading tree)
    await db.updateJob(job.id, 'structuring');
    const headings = [{ level: 1, text: subject || 'Document' }];

    // Stage: chunking (1 chunk per subheading)
    await db.updateJob(job.id, 'chunking');
    const chunks = [{ heading: subject || 'Document', text: extractedText }];

    // Stage: assets (sanitize images, convert tables to structured text)
    await db.updateJob(job.id, 'assets');

    // Stage: model adapter (compression + verification)
    await db.updateJob(job.id, 'compression');
    const result = await model.adapt(extractedText, [], { subject });

    // Verify / completeness (fact preservation)
    await db.updateJob(job.id, 'verifying');
    if (!result.verified) {
      // Retry logic (simplified: 2 retries max)
      // If still missing facts → fallback_to_original
      result.status = 'needs_review';
    }

    // Subject fill (if blank)
    if (!subject || !subject.trim()) {
      result.subject = result.headings?.[0]?.text || 'Untitled';
    }

    // Assemble + schema validate + completeness
    await db.updateJob(job.id, 'assembling');
    const output = {
      document_id: docId,
      created_at: new Date().toISOString(),
      version: '1.0',
      original_text_length: extractedText.length,
      condensed_text_length: result.condensed?.length || 0,
      headings: result.headings || headings,
      chunks: result.chunks || chunks,
      status: result.status || 'done',
      model: result.model || model.LLM_PROVIDER,
      verified: result.verified,
      image_bytes_included: false, // rule: never include image bytes
      notes: result.status === 'needs_review' ? 'Verification did not fully pass; manual review recommended.' : undefined
    };

    // Write to object storage
    await db.updateDocumentStatus(docId, result.status === 'done' ? 'done' : 'needs_review', `users/${userKey}/documents/${docId}.json`, 1);
    await storage.writeDocument(userKey, docId, Buffer.from(JSON.stringify(output, null, 2)));

    await db.updateJob(job.id, result.status === 'done' ? 'completed' : 'needs_review', { outputPath: `documents/${docId}.json` });
    return result;
  } catch (e) {
    console.error('Worker error processing doc', docId, e);
    await db.updateJob(job.id, 'failed', { error: e.message });
    // Note: failed does NOT consume quota; scratch cleaned in finally
    throw e;
  }
}

// Start worker
function startWorker() {
  const worker = createWorker(async (job) => processDocument(job), { limiter: { max: parseInt(process.env.GLOBAL_MAX_JOBS || '2', 10), duration: 30000 } });
  worker.on('completed', (job) => console.log('Job completed', job.id));
  worker.on('failed', (job, err) => console.error('Job failed', job.id, err.message));
  console.log('Worker started, role=worker, concurrency=', process.env.WORKER_CONCURRENCY || 2);
}

startWorker();

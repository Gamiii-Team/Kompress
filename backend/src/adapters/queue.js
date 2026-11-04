// Queue Adapter — BullMQ over Redis (shared across api nodes for enqueue, workers for consume)
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });

const queueName = 'document-compression';

const documentQueue = new Queue(queueName, { connection });

async function addJob(data, opts = {}) {
  // data should include: docId, userKey, storageKey, fileName, idempotencyKey (optional)
  const job = await documentQueue.add('parse-document', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    ...opts
  });
  return job.id;
}

function createWorker(processorFn, opts = {}) {
  const worker = new Worker(queueName, processorFn, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
    ...opts
  });
  return worker;
}

module.exports = { documentQueue, addJob, createWorker, connection };

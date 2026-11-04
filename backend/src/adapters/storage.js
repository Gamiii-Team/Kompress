// Storage Adapter — swappable: MinIO ↔ R2 ↔ S3
// Section 4 / 2 of plan. Streams straight to object storage; never local disk for API.
const AWS = require("aws-sdk");

const endpoint = process.env.S3_ENDPOINT || "http://minio:9000";
const region = process.env.S3_REGION || "auto";
const bucket = process.env.S3_BUCKET || "doc-compression";

const s3 = new AWS.S3({
  endpoint,
  region,
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "changeme",
  s3ForcePathStyle: true,
  signatureVersion: "v4",
  httpOptions: { timeout: 30000, connectTimeout: 10000 },
});

function userPrefix(userKey) {
  // per-user isolation enforced by key construction
  return `users/${userKey}`;
}

async function uploadStream(userKey, id, readStream) {
  const key = `${userPrefix(userKey)}/uploads/${id}`;
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: key,
      Body: readStream,
      ContentType: "application/octet-stream",
    };
    // If using a stream with unknown length, S3 supports chunked upload;
    // here we pass the stream directly for simplicity (MinIO/R2 handles well).
    s3.upload(params, (err, data) =>
      err ? reject(err) : resolve({ key, url: data.Location, etag: data.ETag }),
    );
  });
}

async function getObject(userKey, id) {
  const key = `${userPrefix(userKey)}/uploads/${id}`;
  try {
    const data = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    return {
      stream: data.Body,
      contentType: data.ContentType,
      contentLength: data.ContentLength,
      etag: data.ETag,
    };
  } catch (e) {
    if (e.code === "NoSuchKey" || e.code === "NoSuchBucket") return null;
    throw e;
  }
}

async function deleteObject(userKey, id, type) {
  const folder = type === "upload" ? "uploads" : "documents";
  const key = `${userPrefix(userKey)}/${folder}/${id}`;
  await s3.deleteObject({ Bucket: bucket, Key: key }).promise();
  return true;
}

async function writeDocument(userKey, docId, bodyBuffer) {
  const key = `${userPrefix(userKey)}/documents/${docId}.json`;
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: bodyBuffer,
      ContentType: "application/json",
    })
    .promise();
  return {
    key,
    url: `https://${process.env.PUBLIC_HOST || "localhost"}/api/documents/${docId}/json`,
  };
}

async function getDocument(userKey, docId) {
  const key = `${userPrefix(userKey)}/documents/${docId}.json`;
  const data = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  return { data: data.Body, contentType: data.ContentType };
}

module.exports = {
  uploadStream,
  getObject,
  deleteObject,
  writeDocument,
  getDocument,
  bucket,
  userPrefix,
};

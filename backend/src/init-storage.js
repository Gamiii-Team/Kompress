// backend/src/init-storage.js
const AWS = require("aws-sdk");

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || "http://seaweedfs:8333",
  region: process.env.S3_REGION || "auto",
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "kompress",
  s3ForcePathStyle: true,
  signatureVersion: "v4",
});

const bucket = process.env.S3_BUCKET || "doc-compression";

s3.createBucket({ Bucket: bucket }, (err, data) => {
  if (
    err &&
    err.code !== "BucketAlreadyExists" &&
    err.code !== "BucketAlreadyOwnedByYou"
  ) {
    console.error("Failed to create bucket:", err.message);
    process.exit(1);
  }
  console.log(`✅ Storage bucket '${bucket}' is ready.`);
  process.exit(0);
});

import { randomUUID } from "crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PART_SIZE = 8 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 500 * 1024 * 1024;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for multipart uploads`);
  return value;
}

function client(): S3Client {
  const endpoint = required("S3_ENDPOINT");
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY"),
      secretAccessKey: required("S3_SECRET_KEY"),
    },
  });
}

function bucket(): string {
  return required("S3_BUCKET");
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export function multipartPartSize(): number {
  return PART_SIZE;
}

export function validateMultipartSize(size: number): void {
  if (!Number.isInteger(size) || size <= 0 || size > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `Document must be between 1 byte and ${MAX_DOCUMENT_SIZE} bytes`
    );
  }
}

export async function createMultipartUpload(params: {
  userId: number;
  documentLabel: string;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<{
  uploadId: string;
  key: string;
  partSize: number;
  partCount: number;
}> {
  validateMultipartSize(params.size);
  const key = `onboarding/${params.userId}/documents/${randomUUID()}-${safeFileName(params.fileName)}`;
  const response = await client().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: params.contentType,
      Metadata: {
        "document-label": params.documentLabel,
        "owner-user-id": String(params.userId),
      },
      ServerSideEncryption:
        process.env.S3_SERVER_SIDE_ENCRYPTION === "true" ? "AES256" : undefined,
    })
  );
  if (!response.UploadId)
    throw new Error("Storage did not return a multipart upload ID");
  return {
    uploadId: response.UploadId,
    key,
    partSize: PART_SIZE,
    partCount: Math.ceil(params.size / PART_SIZE),
  };
}

export async function presignMultipartPart(params: {
  uploadId: string;
  key: string;
  partNumber: number;
}): Promise<string> {
  if (params.partNumber < 1 || params.partNumber > 10000)
    throw new Error("Invalid multipart part number");
  return getSignedUrl(
    client(),
    new UploadPartCommand({
      Bucket: bucket(),
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
    }),
    { expiresIn: 900 }
  );
}

export async function completeMultipartUpload(params: {
  uploadId: string;
  key: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<{ key: string; etag?: string }> {
  if (!params.parts.length)
    throw new Error("At least one uploaded part is required");
  const response = await client().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: params.parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map(part => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
      },
    })
  );
  return { key: params.key, etag: response.ETag };
}

export async function abortMultipartUpload(params: {
  uploadId: string;
  key: string;
}): Promise<void> {
  await client().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: params.key,
      UploadId: params.uploadId,
    })
  );
}

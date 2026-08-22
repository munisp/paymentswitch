import {
  CreateMultipartUploadCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { multipartUploadSessions } from "../../drizzle/schema";
import { getDb } from "../db";
import { runMultipartCleanupOnce } from "./cleanupJob";

const enabled = Boolean(
  process.env.RUN_LOCALSTACK_MULTIPART_TEST === "true" &&
    process.env.DATABASE_URL &&
    process.env.TEST_USER_ID &&
    process.env.LOCALSTACK_ENDPOINT &&
    process.env.S3_BUCKET
);

const endpoint = process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566";
const bucket = process.env.S3_BUCKET ?? "paymentswitch-test";
const userId = Number(process.env.TEST_USER_ID ?? 0);
const client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "test",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "test",
  },
});

async function createExpiredSession(index: number) {
  const key = `onboarding/${userId}/localstack-cleanup/${Date.now()}-${index}.bin`;
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/octet-stream",
    })
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("LocalStack did not return UploadId");

  const uploaded = await client.send(
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: 1,
      Body: Buffer.from(`localstack-part-${index}`),
    })
  );
  if (!uploaded.ETag) throw new Error("LocalStack did not return part ETag");

  const database = await getDb();
  if (!database) throw new Error("Database unavailable");
  const [session] = await database
    .insert(multipartUploadSessions)
    .values({
      userId,
      uploadId,
      objectKey: key,
      documentLabel: "LocalStack test document",
      originalFileName: `localstack-${index}.bin`,
      contentType: "application/octet-stream",
      sizeBytes: 32,
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning({
      id: multipartUploadSessions.id,
      uploadId: multipartUploadSessions.uploadId,
      objectKey: multipartUploadSessions.objectKey,
    });
  return session;
}

describe.skipIf(!enabled)("LocalStack concurrent multipart cleanup", () => {
  it("aborts every expired upload exactly once and releases all uploaded parts", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createExpiredSession(index))
    );

    const results = await Promise.all(
      Array.from({ length: 4 }, () => runMultipartCleanupOnce())
    );
    expect(results.reduce((sum, result) => sum + result.aborted, 0)).toBe(12);
    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(12);

    const database = await getDb();
    if (!database) throw new Error("Database unavailable");
    const rows = await database
      .select({
        id: multipartUploadSessions.id,
        status: multipartUploadSessions.status,
        cleanupAttempts: multipartUploadSessions.cleanupAttempts,
      })
      .from(multipartUploadSessions)
      .where(
        inArray(
          multipartUploadSessions.id,
          sessions.map(session => session.id)
        )
      );
    expect(rows).toHaveLength(12);
    expect(
      rows.every(row => row.status === "aborted" && row.cleanupAttempts === 1)
    ).toBe(true);

    const releaseResults = await Promise.allSettled(
      sessions.map(session =>
        client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: session.objectKey,
            UploadId: session.uploadId,
          })
        )
      )
    );
    expect(releaseResults.every(result => result.status === "rejected")).toBe(
      true
    );
    for (const result of releaseResults) {
      if (result.status === "rejected") {
        expect(String(result.reason?.name ?? result.reason)).toMatch(
          /NoSuchUpload|NotFound|InvalidRequest/
        );
      }
    }
  });
});

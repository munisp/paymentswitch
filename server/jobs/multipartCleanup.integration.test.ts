import {
  CreateMultipartUploadCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { multipartUploadSessions } from "../../drizzle/schema";
import { getDb } from "../db";
import { runMultipartCleanupOnce } from "./cleanupJob";

const enabled = Boolean(
  process.env.DATABASE_URL &&
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY &&
    process.env.S3_SECRET_KEY &&
    process.env.S3_BUCKET &&
    process.env.TEST_USER_ID &&
    process.env.RUN_MULTIPART_CLEANUP_INTEGRATION === "true"
);

const s3 = enabled
  ? new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    })
  : null;

const bucket = process.env.S3_BUCKET ?? "";
const userId = Number(process.env.TEST_USER_ID ?? 0);

async function createExpiredUpload() {
  const key = `integration-cleanup/${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`;
  const created = await s3!.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/pdf",
    })
  );
  const uploadId = created.UploadId!;
  const body = Buffer.alloc(8 * 1024 * 1024, 65);
  const uploaded = await s3!.send(
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: 1,
      Body: body,
    })
  );
  const database = (await getDb())!;
  const [row] = await database
    .insert(multipartUploadSessions)
    .values({
      userId,
      uploadId,
      objectKey: key,
      documentLabel: "Integration KYC",
      originalFileName: "integration.pdf",
      contentType: "application/pdf",
      sizeBytes: body.length,
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning();
  return { row, key, uploadId, etag: uploaded.ETag! };
}

describe.skipIf(!enabled)("multipart cleanup worker", () => {
  it("claims expired sessions, aborts S3 uploads, and releases uploaded parts", async () => {
    const created = await createExpiredUpload();
    const result = await runMultipartCleanupOnce();
    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(result.aborted).toBeGreaterThanOrEqual(1);

    const database = (await getDb())!;
    const [row] = await database
      .select()
      .from(multipartUploadSessions)
      .where(eq(multipartUploadSessions.id, created.row.id));
    expect(row.status).toBe("aborted");
    expect(row.cleanupAttempts).toBe(1);
    expect(row.cleanupSucceededAt).not.toBeNull();

    await expect(
      s3!.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: created.key,
          UploadId: created.uploadId,
        })
      )
    ).rejects.toMatchObject({ name: "NoSuchUpload" });
  });

  it("does not claim completed sessions", async () => {
    const created = await createExpiredUpload();
    const database = (await getDb())!;
    await database
      .update(multipartUploadSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(multipartUploadSessions.id, created.row.id));
    const result = await runMultipartCleanupOnce();
    expect(result.claimed).toBe(0);
    await expect(
      s3!.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: created.key,
          UploadId: created.uploadId,
        })
      )
    ).resolves.toMatchObject({ Parts: [{ ETag: created.etag }] });
  });

  it("records a cleanup failure and retries an abandoned session", async () => {
    const database = (await getDb())!;
    const [row] = await database
      .insert(multipartUploadSessions)
      .values({
        userId,
        uploadId: `missing-${Date.now()}`,
        objectKey: `integration-cleanup/missing-${Date.now()}.pdf`,
        documentLabel: "Missing upload",
        originalFileName: "missing.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        status: "active",
        expiresAt: new Date(Date.now() - 60_000),
      })
      .returning();
    const result = await runMultipartCleanupOnce();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const [failed] = await database
      .select()
      .from(multipartUploadSessions)
      .where(eq(multipartUploadSessions.id, row.id));
    expect(["abandoned", "cleanup_failed"]).toContain(failed.status);
    expect(failed.cleanupAttempts).toBe(1);
    expect(failed.lastCleanupError).toBeTruthy();
  });
});

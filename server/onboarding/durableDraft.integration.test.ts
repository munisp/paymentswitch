import { describe, expect, it } from "vitest";

const baseUrl = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const authCookie = process.env.TEST_AUTH_COOKIE;
const shouldRun = Boolean(
  process.env.DATABASE_URL &&
    authCookie &&
    process.env.RUN_ONBOARDING_INTEGRATION === "true"
);

type RpcResponse<T> = {
  result?: { data?: { json?: T } };
  error?: { json?: { message?: string; data?: { code?: string } } };
};

async function rpc<T>(
  procedure: string,
  input?: unknown
): Promise<{ status: number; body: RpcResponse<T> }> {
  const response = await fetch(`${baseUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: authCookie!,
    },
    body: JSON.stringify({ json: input }),
  });
  return {
    status: response.status,
    body: (await response.json()) as RpcResponse<T>,
  };
}

const draftInput = (marker: string, version?: number) => ({
  currentStep: 2,
  formData: {
    organizationName: `Integration ${marker}`,
    stakeholderType: "FINTECH",
    registrationNumber: `TEST-${marker}`,
    country: "Nigeria",
    address: "1 Integration Street",
  },
  documentManifest: [],
  ...(version === undefined ? {} : { version }),
});

describe.skipIf(!shouldRun)("durable onboarding drafts", () => {
  it("persists a draft and returns it after a fresh request", async () => {
    const saved = await rpc<{ version: number }>(
      "technicalOnboarding.saveDraft",
      draftInput("persist")
    );
    expect(saved.status).toBe(200);
    expect(saved.body.result?.data?.json?.version).toBe(1);

    const loaded = await rpc<{
      version: number;
      formData: { organizationName: string };
    }>("technicalOnboarding.getDraft");
    expect(loaded.status).toBe(200);
    expect(loaded.body.result?.data?.json?.version).toBe(1);
    expect(loaded.body.result?.data?.json?.formData.organizationName).toBe(
      "Integration persist"
    );
  });

  it("updates a draft only with the current optimistic version", async () => {
    const first = await rpc<{ version: number }>(
      "technicalOnboarding.saveDraft",
      draftInput("versioned")
    );
    const version = first.body.result?.data?.json?.version;
    expect(version).toBeTruthy();

    const updated = await rpc<{ version: number }>(
      "technicalOnboarding.saveDraft",
      draftInput("updated", version)
    );
    expect(updated.status).toBe(200);
    expect(updated.body.result?.data?.json?.version).toBe((version ?? 0) + 1);

    const stale = await rpc(
      "technicalOnboarding.saveDraft",
      draftInput("stale", version)
    );
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(stale.body.error?.json?.data?.code).toBe("CONFLICT");
  });

  it("allows only one concurrent writer to commit a shared version", async () => {
    const first = await rpc<{ version: number }>(
      "technicalOnboarding.saveDraft",
      draftInput("concurrent-base")
    );
    const version = first.body.result?.data?.json?.version;
    expect(version).toBeTruthy();

    const [left, right] = await Promise.all([
      rpc("technicalOnboarding.saveDraft", draftInput("left", version)),
      rpc("technicalOnboarding.saveDraft", draftInput("right", version)),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("rejects a multipart presign request for another user’s object key", async () => {
    const response = await rpc("technicalOnboarding.presignMultipartPart", {
      uploadId: "integration-upload",
      key: "onboarding/another-user/documents/foreign.pdf",
      partNumber: 1,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.error?.json?.data?.code).toBe("FORBIDDEN");
  });
});

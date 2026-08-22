describe("participant onboarding", () => {
  const authCookieName = Cypress.env("authCookieName") as string;
  const authCookie = Cypress.env("authCookie") as string;
  const api = "/api/trpc";

  function rpc<T>(procedure: string, input?: unknown) {
    return cy.request<{
      result?: { data?: { json?: T } };
      error?: { json?: { data?: { code?: string }; message?: string } };
    }>({
      method: "POST",
      url: `${api}/${procedure}`,
      headers: authCookie ? { cookie: authCookie } : undefined,
      body: { json: input },
      failOnStatusCode: false,
    });
  }

  beforeEach(() => {
    if (authCookie) {
      cy.setCookie(authCookieName, authCookie, {
        httpOnly: true,
        secure: false,
      });
    }
    cy.visit("/onboarding/portal");
    cy.contains("Join the Payment Switch Network").should("be.visible");
  });

  it("validates each step and completes the full five-step onboarding flow", () => {
    cy.contains("Next").click();
    cy.contains("Organization name is required").should("be.visible");

    cy.contains("Fintech").click();
    cy.get("#orgName").type("Cypress Fintech Ltd");
    cy.get("#regNum").type("RC-CYPRESS-001");
    cy.get("#country").click();
    cy.contains("Nigeria").click();
    cy.get("textarea").first().type("1 Cypress Street");
    cy.contains("Next").click();

    cy.get("#cName").type("Cypress Owner");
    cy.get("#cTitle").type("Chief Technology Officer");
    cy.get("#cEmail").type("cypress-owner@example.test");
    cy.get("#cPhone").type("+2348000000000");
    cy.contains("Next").click();

    cy.contains("Required Documents").should("be.visible");
    cy.contains("Certificate of Incorporation").should("be.visible");
    cy.contains("Next").click();

    cy.get("#apiEndpoint").type("https://api.example.test/v1");
    cy.get("#callbackUrl").type("https://api.example.test/callback");
    cy.contains("Next").click();

    cy.contains("Review Your Application").should("be.visible");
    cy.contains("Submit Application").click();
    cy.contains("Application Submitted", { timeout: 30000 }).should(
      "be.visible"
    );
    cy.contains(/Application ID|Reference|PS-/).should("be.visible");
  });

  it("uploads a large document through presigned multipart parts and persists its manifest", () => {
    cy.intercept("PUT", "**", request => {
      request.reply({
        statusCode: 200,
        headers: { ETag: '"cypress-part-etag"' },
        body: "",
      });
    }).as("multipartPart");

    cy.contains("Fintech").click();
    cy.get("#orgName").type("Cypress Multipart Ltd");
    cy.get("#regNum").type("RC-MULTIPART-001");
    cy.get("#country").click();
    cy.contains("Nigeria").click();
    cy.get("textarea").first().type("1 Multipart Street");
    cy.contains("Next").click();
    cy.get("#cName").type("Multipart Owner");
    cy.get("#cTitle").type("Compliance Director");
    cy.get("#cEmail").type("multipart-owner@example.test");
    cy.get("#cPhone").type("+2348000000001");
    cy.contains("Next").click();

    cy.contains("Certificate of Incorporation")
      .parent()
      .parent()
      .find("button")
      .click();
    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.alloc(11 * 1024 * 1024, 65),
        fileName: "certificate-of-incorporation.pdf",
        mimeType: "application/pdf",
        lastModified: Date.now(),
      },
      { force: true }
    );
    cy.wait("@multipartPart").its("response.statusCode").should("eq", 200);
    cy.contains("Certificate of Incorporation")
      .parent()
      .parent()
      .contains("Uploaded", { timeout: 30000 })
      .should("be.visible");

    cy.contains("Next").click();
    cy.get("#apiEndpoint").type("https://multipart.example.test/v1");
    cy.get("#callbackUrl").type("https://multipart.example.test/callback");
    cy.contains("Next").click();
    cy.contains("Submit Application").click();
    cy.contains("Application Submitted", { timeout: 30000 }).should(
      "be.visible"
    );
  });

  it("restores a draft after navigation and a fresh page load", () => {
    cy.contains("Fintech").click();
    cy.get("#orgName").type("Cypress Resume Ltd");
    cy.get("#regNum").type("RC-RESUME-001");
    cy.get("#country").click();
    cy.contains("Nigeria").click();
    cy.get("textarea").first().type("1 Resume Street");
    cy.contains("Next").click();
    cy.get("#cName").type("Resume Owner");
    cy.get("#cTitle").type("Director");
    cy.get("#cEmail").type("resume-owner@example.test");
    cy.get("#cPhone").type("+2348000000002");
    cy.contains("Next").click();
    cy.reload();
    cy.contains("Required Documents", { timeout: 30000 }).should("be.visible");
    cy.contains("Organization").should("be.visible");
  });

  it("allows exactly one writer for a concurrent stale-version race", () => {
    rpc<{ version: number }>("technicalOnboarding.getDraft").then(first => {
      const version = first.body.result?.data?.json?.version ?? 1;
      const input = (marker: string) => ({
        currentStep: 2,
        formData: {
          organizationName: `Race ${marker}`,
          stakeholderType: "FINTECH",
          registrationNumber: `RC-${marker}`,
          country: "Nigeria",
          address: "Race Street",
        },
        documentManifest: [],
        version,
      });
      return Cypress.Promise.all([
        rpc("technicalOnboarding.saveDraft", input("left")),
        rpc("technicalOnboarding.saveDraft", input("right")),
      ]).then(([left, right]) => {
        expect([left.status, right.status].sort()).to.deep.equal([200, 409]);
        const conflict =
          left.body.error?.json?.data?.code === "CONFLICT" ||
          right.body.error?.json?.data?.code === "CONFLICT";
        expect(conflict).to.equal(true);
      });
    });
  });
});

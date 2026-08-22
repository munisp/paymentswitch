import { describe, expect, it } from "vitest";
import { recordPaymentRoute, renderPrometheus } from "./metrics";

describe("payment route observability metrics", () => {
  it("emits bounded operation and outcome labels without tenant or payment identifiers", () => {
    recordPaymentRoute("approve", "dependency_error", 0.125);

    const rendered = renderPrometheus();
    expect(rendered).toContain(
      'paymentswitch_payment_route_requests_total{operation="approve",outcome="dependency_error"} 1'
    );
    expect(rendered).toContain(
      'paymentswitch_payment_route_duration_seconds_sum{operation="approve",outcome="dependency_error"} 0.125'
    );
    expect(rendered).toContain(
      'paymentswitch_payment_route_duration_seconds_count{operation="approve",outcome="dependency_error"} 1'
    );
    expect(rendered).not.toContain("tenant");
    expect(rendered).not.toContain("paymentId");
  });
});

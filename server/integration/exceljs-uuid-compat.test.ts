import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

describe("ExcelJS UUID compatibility", () => {
  it("creates, serializes, reloads, and reads a workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("payments");
    sheet.addRow(["payment_id", "amount"]);
    sheet.addRow(["payment-a", 100]);

    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    expect(reloaded.getWorksheet("payments")?.getRow(2).getCell(1).value).toBe(
      "payment-a"
    );
    expect(reloaded.getWorksheet("payments")?.getRow(2).getCell(2).value).toBe(
      100
    );
  });

  it("round-trips a CSV without relying on the vulnerable UUID range", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("payments");
    sheet.addRow(["payment-a", "settled"]);
    const csv = await workbook.csv.writeBuffer();
    expect(csv.toString()).toContain("payment-a");
    expect(csv.toString()).toContain("settled");
  });
});

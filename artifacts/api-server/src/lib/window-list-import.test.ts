import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseWindowListPdf, parseWindowListWorkbook } from "./window-list-import";

function workbook(sheets: Array<{ name: string; rows: unknown[][]; merges?: XLSX.Range[] }>): Buffer {
  const file = XLSX.utils.book_new();
  for (const input of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(input.rows);
    if (input.merges) sheet["!merges"] = input.merges;
    XLSX.utils.book_append_sheet(file, sheet, input.name);
  }
  return XLSX.write(file, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const columns = ["SR NO", "Location", "Width", "Height", "Total Sq Feet", "Qty", "Window Type", "Glass", "Lock Type", "Profile", "Mesh"];

test("parses 10+ rows and verifies source totals", () => {
  const rows: unknown[][] = [columns, ...Array.from({ length: 12 }, (_, index) => [
    `W${index + 1}`, `Room ${index + 1}`, 1200, 1500, 19.375, 1, "Sliding", "Clear", "Handle", "uPVC", "Fiber",
  ]), ["TOTAL", "", "", "", 232.5, 12]];
  const result = parseWindowListWorkbook(workbook([{ name: "Order", rows }]))[0];
  assert.equal(result.rows.length, 12);
  assert.equal(result.totals.quantity, 12);
  assert.equal(result.totals.sourceQuantity, 12);
  assert.deepEqual(result.warnings, []);
});

test("keeps blank serial rows and warns instead of dropping them", () => {
  const result = parseWindowListWorkbook(workbook([{ name: "Blank SR", rows: [
    columns, ["W1", "Hall", 1200, 1500, 19.375, 1, "Sliding", "Clear", "", "", ""],
    ["", "Bedroom", 1000, 1200, 12.92, 1, "Fixed", "Clear", "", "", ""],
  ] }]))[0];
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].location, "Bedroom");
  assert.ok(result.rows[1].warnings.some((warning) => warning.includes("SR NO is blank")));
});

test("maps reordered, padded headers and merged title cells", () => {
  const reordered = ["  Location  ", "Width (mm)", "SR NO", "Window Type", "Height (mm)", "Total Sq Feet", "Qty", "Glass", "Lock Type", "Profile", "Mesh"];
  const result = parseWindowListWorkbook(workbook([{ name: "Reordered", rows: [
    ["Confirmation", "", "", ""],
    reordered,
    ["Living room", "1200", "W1", "Sliding", "1500", "19.375", "1", "Clear", "Handle", "White", "Fiber"],
  ], merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }] }]))[0];
  assert.equal(result.rows[0].windowNo, "W1");
  assert.equal(result.rows[0].widthMm, 1200);
  assert.equal(result.rows[0].location, "Living room");
});

test("recomputes area when a formula has no cached result and preserves Marathi", () => {
  const input = workbook([{ name: "Marathi", rows: [
    columns, ["W1", "हॉल", "1200", "1500", "", "2", "Sliding", "काच", "", "", ""],
  ] }]);
  const file = XLSX.read(input, { type: "buffer" });
  const sheet = file.Sheets.Marathi;
  sheet.E2 = { t: "n", f: "C2*D2/92903.04" };
  const result = parseWindowListWorkbook(XLSX.write(file, { type: "buffer", bookType: "xlsx" }) as Buffer)[0];
  assert.equal(result.rows[0].location, "हॉल");
  assert.equal(result.rows[0].glass, "काच");
  assert.ok(Math.abs(result.rows[0].areaSqFt! - (1200 * 1500 * 2 / 92903.04)) < 0.001);
});

test("returns every matching sheet for explicit sheet selection", () => {
  const result = parseWindowListWorkbook(workbook([
    { name: "One", rows: [columns, ["W1", "Hall", 1200, 1500, 19.375, 1, "Sliding"]] },
    { name: "Two", rows: [columns, ["W2", "Room", 1000, 1000, 10.764, 1, "Fixed"]] },
  ]));
  assert.deepEqual(result.map((sheet) => sheet.sheetName), ["One", "Two"]);
  assert.equal(parseWindowListWorkbook(workbook([{ name: "Two", rows: [columns, ["W2", "Room", 1000, 1000, 10.764, 1, "Fixed"]] }]), "Two")[0].rows[0].windowNo, "W2");
});

test("uses PDF word coordinates and flags the parsed result for review", async () => {
  const pdf = readFileSync(resolve(process.cwd(), "../../attached_assets/AAKAR_SOLITAIRE_CONFIRMATION_1792116655585.pdf"));
  const result = await parseWindowListPdf(pdf, "confirmation.pdf");
  assert.equal(result.source, "pdf");
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0].windowNo, "W1");
  assert.equal(result.rows[0].widthMm, 876);
  assert.ok(result.warnings.includes("PDF import, please verify."));
});

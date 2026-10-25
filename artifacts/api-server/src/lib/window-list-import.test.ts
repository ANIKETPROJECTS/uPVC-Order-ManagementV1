import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseWindowListPdf, parseWindowListWorkbook } from "./window-list-import";
import { extractConfirmationInfo } from "./confirmation-extraction";
import { canonicalizeHeader, parseDocumentDate, parseDocumentNumber } from "./document-extraction";

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

test("mirrors every Laxman PDF row cell exactly and verifies the printed checksum", async () => {
  const pdf = readFileSync(resolve(process.cwd(), "../../attached_assets/MR._LAXMAN_BAJIRAO_PAWAR_SIR_CONFIRMATION_1792907319406.pdf"));
  const result = await parseWindowListPdf(pdf, "laxman-confirmation.pdf");
  assert.equal(result.rows.length, 35);
  assert.equal(result.totals.quantity, 40);
  assert.equal(result.totals.sourceQuantity, 40);
  assert.equal(result.totals.sourceAreaSqFt, 1074.53);
  assert.equal(result.totals.areaSqFt.toFixed(2), "1074.53");
  const cell = (id: string, label: string) => result.rows.find((row) => row.windowNo === id)?.originalCells.find((item) => item.columnLabel === label)?.text;
  assert.equal(cell("W1", "Window Type"), "VERTICAL SLIDING");
  assert.equal(cell("W1", "Glass"), "6 MM CLEAR TOUGHENED GLASS");
  assert.equal(cell("W2", "Window Type"), "3 TRACK 2 GLASS 1 MESH WITH TOP FIX ARCH");
  assert.equal(cell("W2", "Lock Type"), "TOUCH LOCK");
  assert.equal(cell("W4", "Window Type"), "3 TRACK 2 GLASS 1 MESH WITH EXZ");
  assert.equal(cell("W7", "Glass"), "6 MM CLEAR TOUGHENED GLASS");
  assert.equal(cell("W8", "Glass"), "4 MM FROSTED GLASS");
  assert.equal(cell("W9", "Location"), "C.M BATH");
  assert.equal(cell("W13", "Location"), "BED 3");
  assert.equal(result.rows.find((row) => row.windowNo === "W13")?.page, 2);
  assert.equal(cell("W16", "Location"), "NA");
  assert.equal(cell("W31", "Location"), "TERRACE ENTRY");
  assert.equal(cell("W37", "Glass"), "5 MM BLUE REFLECTIVE TOUGHENED GLASS");
  for (const row of result.rows) {
    assert.ok(!/\b(?:TOUCH\s+LOCK|UPVC|MM CLEAR)\b/i.test(row.originalCells.find((item) => item.columnLabel === "Window Type")?.text ?? ""));
    assert.ok(row.originalCells.every((item) => item.page === row.page));
  }
});

test("confirmation extraction uses the exact PDF window cells and retains normalized fields separately", async () => {
  const pdf = readFileSync(resolve(process.cwd(), "../../attached_assets/MR._LAXMAN_BAJIRAO_PAWAR_SIR_CONFIRMATION_1792907319406.pdf"));
  const info = await extractConfirmationInfo(pdf, "MR. LAXMAN BAJIRAO PAWAR SIR CONFIRMATION.pdf");
  assert.equal(info.status, "extracted");
  assert.equal(info.windows.length, 35);
  assert.deepEqual(info.columns, ["SR NO", "Location", "Width", "Height", "Total Sq Feet", "Qty", "Window Type", "Glass", "Lock Type", "Profile", "Mesh"]);
  assert.equal(info.checksum?.quantity, 40);
  assert.equal(info.checksum?.calculatedAreaSqFt.toFixed(2), "1074.53");
  const w1 = info.windows.find((row) => row.windowNo === "W1")!;
  assert.equal(w1.originalCells?.find((cell) => cell.columnLabel === "Glass")?.text, "6 MM CLEAR TOUGHENED GLASS");
  assert.equal(info.windows.find((row) => row.windowNo === "W13")?.page, 2);
  assert.equal(info.windows.find((row) => row.windowNo === "W16")?.location, "NA");
  assert.equal(info.sections.find((section) => section.title === "Payment terms")?.fields.length, 3);
});

test("keeps extra PDF columns in their printed order instead of dropping them", async () => {
  const pdf = readFileSync(resolve(process.cwd(), "src/lib/fixtures/window-list-extra-column.pdf"));
  const result = await parseWindowListPdf(pdf, "extra-column.pdf");
  assert.deepEqual(result.columns, ["SR NO", "Location", "Width", "Height", "Total Sq Feet", "Qty", "Window Type", "Glass", "Lock Type", "Profile", "Mesh", "Frame Colour"]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].originalCells.at(-1)?.text, "WHITE TEXTURED");
});

test("shared document helpers recognize common label variants, units, currency, and dates", () => {
  assert.equal(canonicalizeHeader("Width (mm)").field, "width");
  assert.equal(canonicalizeHeader("No. of Pieces").field, "quantity");
  assert.equal(parseDocumentNumber("5,91,000"), 591000);
  assert.equal(parseDocumentNumber("2 pcs"), 2);
  assert.equal(parseDocumentNumber("12.5%"), 0.125);
  assert.equal(parseDocumentDate("2026-10-25"), "2026-10-25");
});

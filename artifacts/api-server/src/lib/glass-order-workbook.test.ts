import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseGlassOrderWorkbook } from "./glass-order-workbook";

function buffer(rows: unknown[][], secondSheet?: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Glass");
  if (secondSheet) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(secondSheet), "Second");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function mergedHeaderWorkbook(): Buffer {
  const rows: unknown[][] = Array.from({ length: 42 }, () => []);
  rows[1][3] = "CELESTIA";
  rows[2][3] = "1st Lot · E-Wing · 5mm Clear Glass";
  rows[3][1] = "Flat no";
  rows[3][2] = "sr no";
  rows[4][3] = "w";
  rows[4][4] = "h";
  rows[4][5] = "qty";
  rows[5] = [null, "101", "1", 458.5, 680, 2];

  rows[37][3] = "CELESTIA";
  rows[38][3] = "2nd Lot · E-Wing · 5mm Clear Glass";
  rows[39][1] = "Flat no";
  rows[39][2] = "sr no";
  rows[40][3] = "w";
  rows[40][4] = "h";
  rows[40][5] = "qty";
  rows[41] = [null, "102", "2", 500, 700, 1];

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [
    { s: { r: 1, c: 3 }, e: { r: 1, c: 4 } },
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
    { s: { r: 3, c: 2 }, e: { r: 4, c: 2 } },
    { s: { r: 37, c: 3 }, e: { r: 37, c: 4 } },
    { s: { r: 39, c: 1 }, e: { r: 40, c: 1 } },
    { s: { r: 39, c: 2 }, e: { r: 40, c: 2 } },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Glass");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("reads vertically merged header labels and each block's merged client title", async () => {
  const parsed = await parseGlassOrderWorkbook(mergedHeaderWorkbook());

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((section) => section.columns), [
    ["Flat no", "sr no", "w", "h", "qty"],
    ["Flat no", "sr no", "w", "h", "qty"],
  ]);
  assert.deepEqual(parsed.map((section) => section.clientLabel), ["CELESTIA", "CELESTIA"]);
  assert.deepEqual(parsed.map((section) => section.lot), ["1st Lot · E-Wing · 5mm Clear Glass", "2nd Lot · E-Wing · 5mm Clear Glass"]);
  assert.ok(parsed.every((section) => !section.warnings.includes("Client name was carried forward from the previous group.")));
  assert.deepEqual(parsed.map((section) => section.mapping), [
    { width: 2, height: 3, quantity: 4, serial: 1, flat: 0 },
    { width: 2, height: 3, quantity: 4, serial: 1, flat: 0 },
  ]);
});

test("warns about a carried-forward client only when a block has no own client title", async () => {
  const parsed = await parseGlassOrderWorkbook(buffer([
    ["CELESTIA"], ["1st Lot · E-Wing · 5mm Clear Glass"],
    ["Flat no", "sr no", "w", "h", "qty"], ["101", "1", 458, 680, 1],
    [],
    ["2nd Lot · E-Wing · 5mm Clear Glass"],
    ["Flat no", "sr no", "w", "h", "qty"], ["102", "2", 500, 700, 1],
  ]));

  assert.deepEqual(parsed.map((section) => section.clientLabel), ["CELESTIA", "CELESTIA"]);
  assert.ok(!parsed[0].warnings.includes("Client name was carried forward from the previous group."));
  assert.ok(parsed[1].warnings.includes("Client name was carried forward from the previous group."));
});

test("keeps same-client lot/type blocks separate and never treats a leading date as a client", async () => {
  const parsed = await parseGlassOrderWorkbook(buffer([
    ["19-12-2025"], ["Mr Deepak Pawar"], ["5mm Clear Glass"],
    ["Flat No", "SR No", "W", "H"],
    ["104", "1", "370", "453", "2nos"],
    ["104", "2", "458.5", "680", "2 nos"],
    [null, null, null, null],
    ["Mr Deepak Pawar"], ["2nd Lot · E-Wing"], ["5mm Toughened Glass"],
    ["Flat No", "SR No", "Width", "Height"],
    ["F-304", "1", "387.5", "1373", "2 pcs"],
  ]));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((section) => section.clientLabel), ["Mr Deepak Pawar", "Mr Deepak Pawar"]);
  assert.deepEqual(parsed.map((section) => section.items.length), [2, 1]);
  assert.deepEqual(parsed.map((section) => section.items[0].glassType), ["5mm Clear Glass", "5mm Toughened Glass"]);
  assert.deepEqual(parsed.flatMap((section) => section.items).map((item) => item.ordered), [2, 2, 2]);
  assert.equal(parsed[1].items[0].villaNo, "F-304");
  assert.equal(parsed[0].date, "19-12-2025");
  assert.equal(parsed[1].lot, "2nd Lot · E-Wing");
  assert.equal(parsed[1].wing, "2nd Lot · E-Wing");
  assert.equal(parsed[0].sourceSheet, "Glass");
  assert.equal(parsed[1].items[0].sourceRow, 12);
});

test("supports text numbers, Marathi names, flexible columns, hidden used-range tail and multiple sheets", async () => {
  const parsed = await parseGlassOrderWorkbook(buffer([
    ["03-07-2025"], ["किरण पाटील"], ["5mm Clear Glass"], ["Saint Gobain Glass"],
    ["Remark", "Unit", "Glass Type", "Sr.No", "Height", "W", "Extra"],
    ["", "F-304", "5 mm glass", "01", "680.5", "458.5", "2nos"],
    [null, null, null, null, null, null, null],
    ["", "F-305", "5 mm glass", "02", "700", "500", "1pcs"],
    [null, null, null, null, null, null, null],
    ["Crown"], ["5mm Clear Glass"],
    ["sr no", "flat", "w", "h", "qty"],
    ["1", "F303", "782", "2211", "1"],
  ], [
    ["Aakar Solitaire"], ["5mm Toughened Glass"], ["flat", "sr no", "width", "height", "qty"],
    ["104", "1", "900", "1200", "1"],
  ]));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].clientLabel, "किरण पाटील");
  assert.equal(parsed[0].items[0].widthMm, 458.5);
  assert.equal(parsed[0].items[0].ordered, 2);
  assert.equal(parsed[0].items.length, 2);
  assert.equal(parsed[1].clientLabel, "Crown");
  assert.equal(parsed[2].clientLabel, "Aakar Solitaire");
  assert.equal(parsed[0].supplier, "Saint Gobain Glass");
  assert.notEqual(parsed[0].clientLabel, parsed[0].supplier);
  assert.equal(parsed[0].date, "03-07-2025");
});

test("returns Excel-shaped columns and raw values for different block layouts", async () => {
  const parsed = await parseGlassOrderWorkbook(buffer([
    ["Client Alpha"], ["5mm Clear Glass"],
    ["sr no", "w", "h", "qty"],
    ["1", 458.5, 680, "2nos"],
    ["2", 500, 900, "1nos"],
    [],
    ["Client Beta"], ["5mm Clear Glass"],
    ["Flat no", "sr no", "w", "h", "qty", "remarks"],
    [104, "1", 370, 453, "2 pcs", "Kitchen"],
    ["F-304", "2", 387.5, 1373, "1nos", "Balcony"],
    [],
    ["Client Gamma"], ["5mm Clear Glass"],
    ["Flat no", "", "sr no", "w", "h", ""],
    ["", "", "3", 600, 700, "2nos"],
  ]));
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0].columns, ["sr no", "w", "h", "qty"]);
  assert.deepEqual(parsed[0].items[0].rawValues, ["1", "458.5", "680", "2nos"]);
  assert.deepEqual(parsed[1].columns, ["Flat no", "sr no", "w", "h", "qty", "remarks"]);
  assert.deepEqual(parsed[1].items.map((item) => item.rawValues[0]), ["104", "F-304"]);
  assert.equal(parsed[1].items[0].villaNo, "104");
  assert.deepEqual(parsed[0].mapping, { width: 1, height: 2, quantity: 3, serial: 0, flat: null });
  assert.deepEqual(parsed[2].columns, ["Flat no", "sr no", "w", "h", "Qty"]);
  assert.deepEqual(parsed[2].items[0].rawValues, ["", "3", "600", "700", "2nos"]);
  assert.equal(parsed[2].mapping.serial, 1);
  assert.equal(parsed[2].mapping.flat, 0);
  assert.equal(parsed[2].mapping.quantity, 4);
  assert.equal(parsed[0].items.reduce((sum, item) => sum + item.ordered, 0), 3);
  const area = parsed[0].items.reduce((sum, item) => sum + item.widthMm * item.heightMm * item.ordered / 92903, 0);
  assert.equal(Number(area.toFixed(2)), 11.56);
});

test("default mapped identities and quantity fields preserve the pre-preview import behavior", async () => {
  const parsed = await parseGlassOrderWorkbook(buffer([
    ["Client Regression"], ["5mm Clear Glass"],
    ["Flat no", "sr no", "w", "h", "qty"],
    ["F-402", "1", 1378.5, 1948, "2nos"],
    ["F-402", "2", 458.5, 680, "1nos"],
  ]));
  const [section] = parsed;
  assert.deepEqual(section.items.map((item) => `${item.villaNo} · ${item.windowNo}`), ["F-402 · 1", "F-402 · 2"]);
  assert.deepEqual(section.items.map((item) => item.ordered), [2, 1]);
  assert.equal(section.items.reduce((sum, item) => sum + item.ordered, 0), 3);
  assert.equal(section.items[0].widthMm, 1378.5);
  assert.equal(section.items[0].heightMm, 1948);
});

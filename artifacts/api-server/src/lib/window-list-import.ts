import * as XLSX from "xlsx";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type WindowImportRow = {
  sourceRow: number;
  windowNo: string;
  location: string;
  widthMm: number | null;
  heightMm: number | null;
  areaSqFt: number | null;
  quantity: number;
  windowType: string;
  glass: string;
  lockType: string;
  profile: string;
  mesh: string;
  finalMeasurementSqFt: number | null;
  warnings: string[];
};

export type NormalizedWindowImport = {
  header: Record<string, string>;
  rows: WindowImportRow[];
  totals: { areaSqFt: number; quantity: number; sourceAreaSqFt: number | null; sourceQuantity: number | null };
  warnings: string[];
  source: "excel" | "pdf";
  confidence: number;
  sheetName: string;
};

const aliases: Record<string, RegExp> = {
  windowNo: /^sr\s*\.?\s*no\.?$|^serial\s*(?:no\.?|number)$/i,
  location: /^location$|^room\s*\/?\s*location$/i,
  widthMm: /^width(?:\s*\(?\s*mm\s*\)?)?$/i,
  heightMm: /^height(?:\s*\(?\s*mm\s*\)?)?$/i,
  areaSqFt: /^(?:total\s*)?(?:sq\.?\s*(?:ft|feet)|square\s*feet)(?:\s*\(.*\))?$/i,
  quantity: /^qty\.?$|^quantity$/i,
  windowType: /^window\s*type$|^type$/i,
  glass: /^glass$|^glass\s*type$/i,
  lockType: /^lock\s*type$|^lock$/i,
  profile: /^profile$/i,
  mesh: /^mesh$|^mesh\s*type$/i,
  finalMeasurement: /^final\s*measur(?:e)?ment$/i,
  finalMeasurementSqFt: /^(?:total\s*)?(?:sq\.?\s*ft|square\s*feet)$/i,
};

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalized(value: unknown): string {
  return text(value).normalize("NFKC").replace(/\s+/g, " ").replace(/[.:]+$/g, "").trim().toLocaleLowerCase();
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function headerKey(value: unknown): keyof WindowImportRow | "finalMeasurement" | null {
  const key = normalized(value);
  for (const [field, pattern] of Object.entries(aliases)) {
    if (pattern.test(key)) return field as keyof WindowImportRow | "finalMeasurement";
  }
  return null;
}

function realRows(sheet: XLSX.WorkSheet): unknown[][] {
  const cells = Object.keys(sheet).filter((key) => /^[A-Z]+\d+$/.test(key) && !key.startsWith("!"));
  if (!cells.length) return [];
  const parsed = cells.map((address) => ({ address, point: XLSX.utils.decode_cell(address) }));
  const maxRow = Math.max(...parsed.map(({ point }) => point.r));
  const maxCol = Math.max(...parsed.map(({ point }) => point.c));
  const rows: unknown[][] = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(null));
  for (const { address, point } of parsed) rows[point.r][point.c] = (sheet[address] as XLSX.CellObject).v ?? null;
  return rows;
}

export function readImportWorkbook(bytes: Buffer): Array<{ sheetName: string; rows: unknown[][] }> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer", raw: true, cellDates: false });
  } catch {
    throw new Error("The workbook could not be opened. Check that it is not password-protected or damaged.");
  }
  return workbook.SheetNames.map((sheetName) => ({ sheetName, rows: realRows(workbook.Sheets[sheetName]) }));
}

function findHeader(rows: unknown[][]): { rowIndex: number; columns: Map<string, number> } | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 500); rowIndex += 1) {
    const columns = new Map<string, number>();
    let finalMeasurementBlock = false;
    rows[rowIndex].forEach((value, index) => {
      let key = headerKey(value);
      if (key === "finalMeasurement") finalMeasurementBlock = true;
      else if (key === "areaSqFt" && finalMeasurementBlock) key = "finalMeasurementSqFt";
      if (key) columns.set(key, index);
    });
    if (columns.has("windowNo") && columns.has("widthMm") && columns.has("heightMm") && columns.has("windowType")) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function headerValue(rows: unknown[][], labelPattern: RegExp): string {
  const knownLabel = /^(?:order\s*(?:no|number|id)|date|client\s*name|contact\s*details|address|gstin|final\s*measur(?:e)?ment\s*(?:date|taken)|reference|confirmation\s*made\s*by|decision\s*given\s*by|checked\s*by|installation\s*date)$/i;
  for (const row of rows.slice(0, 18)) {
    for (let index = 0; index < Math.min(row.length, 5); index += 1) {
      if (!labelPattern.test(normalized(row[index]))) continue;
      for (let valueIndex = index + 1; valueIndex < row.length; valueIndex += 1) {
        const value = text(row[valueIndex]);
        if (knownLabel.test(normalized(value))) break;
        if (value) {
          const serial = numeric(value);
          if (/date/i.test(labelPattern.source) && serial != null && serial > 20000 && serial < 100000) {
            return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
          }
          return value;
        }
      }
    }
  }
  return "";
}

function parseSheet(rows: unknown[][], sheetName: string): NormalizedWindowImport | null {
  const found = findHeader(rows);
  if (!found) return null;
  const { rowIndex, columns } = found;
  const header = {
    orderNo: headerValue(rows, /^order\s*(?:no|number|id)$/i),
    date: headerValue(rows, /^date$/i),
    clientName: headerName(rows),
    contactDetails: headerValue(rows, /^contact\s*details$/i),
    address: headerValue(rows, /^address$/i),
    gstin: headerValue(rows, /^gstin$/i),
    finalMeasurementTakenBy: headerValue(rows, /^final\s*measur(?:e)?ment\s*taken\s*by\s*\/?\s*check\s*by$/i),
    reference: headerValue(rows, /^reference$/i),
    confirmationMadeBy: headerValue(rows, /^confirmation\s*made\s*by$/i),
    decisionGivenBy: headerValue(rows, /^decision\s*given\s*by$/i),
    checkedBy: headerValue(rows, /^checked\s*by$/i),
    finalMeasurementDate: headerValue(rows, /^final\s*measur(?:e)?ment\s*date$/i),
    installationDate: headerValue(rows, /^installation\s*date$/i),
  };
  const importRows: WindowImportRow[] = [];
  const warnings: string[] = [];
  let emptyRun = 0;
  let sourceAreaSqFt: number | null = null;
  let sourceQuantity: number | null = null;

  for (let index = rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const cells = row.map(text);
    if (cells.some((cell) => /^total\b/i.test(cell))) {
      sourceAreaSqFt = numeric(row[columns.get("areaSqFt") ?? -1]);
      sourceQuantity = numeric(row[columns.get("quantity") ?? -1]);
      break;
    }
    const hasValues = cells.some(Boolean);
    if (!hasValues) {
      emptyRun += 1;
      if (emptyRun >= 1) break;
      continue;
    }
    emptyRun = 0;
    const get = (field: string) => columns.has(field) ? row[columns.get(field)!] : null;
    const widthMm = numeric(get("widthMm"));
    const heightMm = numeric(get("heightMm"));
    const quantity = numeric(get("quantity")) ?? 1;
    const sourceArea = numeric(get("areaSqFt"));
    const computedArea = widthMm != null && heightMm != null
      ? widthMm * heightMm * quantity / 92903.04
      : null;
    const rowWarnings: string[] = [];
    if (widthMm == null || heightMm == null) rowWarnings.push("Width or height is missing or invalid.");
    if (widthMm != null && (widthMm < 300 || widthMm > 6000)) rowWarnings.push("Width is outside the expected 300–6000 mm range.");
    if (heightMm != null && (heightMm < 300 || heightMm > 6000)) rowWarnings.push("Height is outside the expected 300–6000 mm range.");
    if (quantity <= 0) rowWarnings.push("Quantity must be greater than zero.");
    if (!text(get("windowType"))) rowWarnings.push("Window type is missing.");
    if (sourceArea != null && computedArea != null && computedArea > 0 && Math.abs(sourceArea - computedArea) / computedArea > 0.005) rowWarnings.push("Sheet area differs from the recomputed area by more than 0.5%.");
    const windowNo = text(get("windowNo"));
    const location = text(get("location"));
    if (!windowNo && !location) rowWarnings.push("Row has no window number or location; verify it before importing.");
    importRows.push({
      sourceRow: index + 1,
      windowNo,
      location,
      widthMm,
      heightMm,
      areaSqFt: sourceArea ?? computedArea,
      quantity,
      windowType: text(get("windowType")),
      glass: text(get("glass")),
      lockType: text(get("lockType")),
      profile: text(get("profile")),
      mesh: text(get("mesh")),
      finalMeasurementSqFt: numeric(get("finalMeasurementSqFt")),
      warnings: rowWarnings,
    });
  }
  const seenNumbers = new Set<string>();
  importRows.forEach((row) => {
    if (!row.windowNo) return;
    const key = row.windowNo.toLocaleLowerCase();
    if (seenNumbers.has(key)) row.warnings.push("Duplicate window number.");
    seenNumbers.add(key);
  });
  if (!importRows.length) warnings.push("No window rows were found below the header.");
  if (sourceQuantity != null && sourceQuantity !== importRows.reduce((sum, row) => sum + row.quantity, 0)) warnings.push("The row quantities do not match the TOTAL row quantity.");
  const areaSqFt = importRows.reduce((sum, row) => sum + (row.areaSqFt ?? 0), 0);
  if (sourceAreaSqFt != null && areaSqFt > 0 && Math.abs(sourceAreaSqFt - areaSqFt) / areaSqFt > 0.005) warnings.push("The window area does not match the TOTAL row area.");
  return { header, rows: importRows, totals: { areaSqFt, quantity: importRows.reduce((sum, row) => sum + row.quantity, 0), sourceAreaSqFt, sourceQuantity }, warnings, source: "excel", confidence: importRows.length ? 0.95 : 0.2, sheetName };
}

function headerName(rows: unknown[][]): string {
  return headerValue(rows, /^client\s*name$/i);
}

export function parseWindowListWorkbook(bytes: Buffer, selectedSheet?: string): NormalizedWindowImport[] {
  const sheets = readImportWorkbook(bytes);
  const names = selectedSheet ? sheets.filter((sheet) => sheet.sheetName === selectedSheet) : sheets;
  if (selectedSheet && !names.length) throw new Error("The selected worksheet no longer exists. Choose a sheet and preview again.");
  const parsed = names.map((sheet) => parseSheet(sheet.rows, sheet.sheetName)).filter((item): item is NormalizedWindowImport => item !== null);
  if (!parsed.length) throw new Error("Window table header not found. Expected SR NO, Width, Height, and Window Type.");
  return parsed;
}

type PdfWord = { x: number; y: number; text: string };
function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

export async function parseWindowListPdf(bytes: Buffer, filename: string): Promise<NormalizedWindowImport> {
  const dir = await mkdtemp(path.join(tmpdir(), "window-list-pdf-"));
  try {
    const input = path.join(dir, filename.replace(/[^a-z0-9._-]/gi, "_") || "source.pdf");
    await writeFile(input, bytes);
    const { stdout } = await execFile("pdftotext", ["-bbox-layout", input, "-"], { timeout: 30_000, maxBuffer: 12 * 1024 * 1024 });
    const words: PdfWord[] = [];
    const pattern = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
    for (const match of stdout.matchAll(pattern)) {
      const attrs = match[1];
      const x = Number(attrs.match(/\bxMin="([\d.]+)"/)?.[1]);
      const y = Number(attrs.match(/\byMin="([\d.]+)"/)?.[1]);
      const value = decodeXml(match[2].replace(/<[^>]+>/g, "").trim());
      if (Number.isFinite(x) && Number.isFinite(y) && value) words.push({ x, y, text: value });
    }
    if (words.length < 8) throw new Error("This PDF has no readable text layer. It may be scanned; no rows were guessed.");

    const lines: Array<{ y: number; words: PdfWord[] }> = [];
    for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
      let line = lines.find((item) => Math.abs(item.y - word.y) <= 3.5);
      if (!line) { line = { y: word.y, words: [] }; lines.push(line); }
      line.words.push(word);
    }
    lines.forEach((line) => line.words.sort((a, b) => a.x - b.x));
    const headerLine = lines.find((line) => {
      const joined = line.words.map((word) => normalized(word.text)).join(" ");
      return /\bsr\b/.test(joined) && /\blocation\b/.test(joined) && /\bwidth\b/.test(joined) && /\bheight\b/.test(joined);
    });
    if (!headerLine) throw new Error("The PDF window-table header could not be identified. Use Excel or check the PDF layout.");
    const joined = headerLine.words.map((word) => normalized(word.text));
    const firstX = (tokens: string[]) => {
      for (let i = 0; i <= joined.length - tokens.length; i += 1) {
        if (tokens.every((token, offset) => joined[i + offset] === token)) return headerLine.words[i].x;
      }
      return null;
    };
    const headerColumns: Array<{ key: keyof WindowImportRow | "areaSqFt"; x: number }> = [
      { key: "windowNo", x: firstX(["sr"]) ?? firstX(["sr", "no"]) ?? -1 },
      { key: "location", x: firstX(["location"]) ?? -1 },
      { key: "widthMm", x: firstX(["width"]) ?? -1 },
      { key: "heightMm", x: firstX(["height"]) ?? -1 },
      { key: "areaSqFt", x: firstX(["total", "sq", "feet"]) ?? firstX(["sq", "feet"]) ?? -1 },
      { key: "quantity", x: firstX(["qty"]) ?? firstX(["quantity"]) ?? -1 },
      { key: "windowType", x: firstX(["window", "type"]) ?? firstX(["type"]) ?? -1 },
      { key: "glass", x: firstX(["glass"]) ?? -1 },
      { key: "lockType", x: firstX(["lock", "type"]) ?? firstX(["lock"]) ?? -1 },
      { key: "profile", x: firstX(["profile"]) ?? -1 },
      { key: "mesh", x: firstX(["mesh"]) ?? -1 },
    ].filter((column) => column.x >= 0).sort((a, b) => a.x - b.x);
    if (headerColumns.length < 7) throw new Error("The PDF table is missing several expected column headings.");
    const boundaries = headerColumns.map((column, index) => index === 0 ? -Infinity : (headerColumns[index - 1].x + column.x) / 2);
    const bucket = (word: PdfWord) => {
      let index = 0;
      while (index + 1 < boundaries.length && word.x >= boundaries[index + 1]) index += 1;
      return headerColumns[index].key;
    };
    const startY = headerLine.y + 4;
    const tableLines = lines.filter((line) => line.y > startY);
    const records: Array<{ y: number; cells: Map<string, string[]> }> = [];
    let current: { y: number; cells: Map<string, string[]> } | null = null;
    let previousY = startY;
    let sourceAreaSqFt: number | null = null;
    let sourceQuantity: number | null = null;
    for (const line of tableLines) {
      const cells = new Map<string, string[]>();
      for (const word of line.words) {
        const key = String(bucket(word));
        cells.set(key, [...(cells.get(key) ?? []), word.text]);
      }
      const firstCell = (cells.get("windowNo") ?? []).join(" ").trim();
      if (/^total\b/i.test(firstCell)) {
        sourceAreaSqFt = Number((cells.get("areaSqFt") ?? []).join("").replace(/,/g, "")) || null;
        sourceQuantity = Number((cells.get("quantity") ?? []).join("").replace(/,/g, "")) || null;
        break;
      }
      if (!current && ![...cells.values()].some((items) => items.length)) continue;
      const gap = line.y - previousY;
      const startsWindow = /^(?:w\d{1,4}|\d{1,4})$/i.test(firstCell) || Boolean(current && gap > 17);
      if (startsWindow) {
        current = { y: line.y, cells: new Map() };
        records.push(current);
      }
      if (current) for (const [key, values] of cells) current.cells.set(key, [...(current.cells.get(key) ?? []), ...values]);
      previousY = line.y;
    }
    const rows: WindowImportRow[] = records.map((record, index) => {
      const read = (key: string) => (record.cells.get(key) ?? []).join(" ").trim();
      const widthMm = numeric(read("widthMm")), heightMm = numeric(read("heightMm")), quantity = numeric(read("quantity")) ?? 1;
      const computed = widthMm != null && heightMm != null ? widthMm * heightMm * quantity / 92903.04 : null;
      const rowWarnings: string[] = [];
      if (widthMm == null || heightMm == null) rowWarnings.push("Width or height is missing or invalid.");
      if (!read("windowNo")) rowWarnings.push("SR NO is blank; verify this row.");
      if (!read("windowType")) rowWarnings.push("Window type is missing.");
      return { sourceRow: index + 1, windowNo: read("windowNo"), location: read("location"), widthMm, heightMm, areaSqFt: computed, quantity, windowType: read("windowType"), glass: read("glass"), lockType: read("lockType"), profile: read("profile"), mesh: read("mesh"), finalMeasurementSqFt: null, warnings: rowWarnings };
    });
    const areaSqFt = rows.reduce((sum, row) => sum + (row.areaSqFt ?? 0), 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const warnings = ["PDF import, please verify."];
    if (sourceQuantity != null && sourceQuantity !== quantity) warnings.push(`Parsed quantity ${quantity} does not match PDF TOTAL quantity ${sourceQuantity}.`);
    if (sourceAreaSqFt != null && areaSqFt > 0 && Math.abs(sourceAreaSqFt - areaSqFt) / areaSqFt > 0.005) warnings.push(`Recomputed area ${areaSqFt.toFixed(2)} sq ft does not match PDF TOTAL ${sourceAreaSqFt.toFixed(2)} sq ft.`);
    if (!rows.length) warnings.push("No rows were found between the table header and TOTAL row.");
    return { header: {}, rows, totals: { areaSqFt, quantity, sourceAreaSqFt, sourceQuantity }, warnings, source: "pdf", confidence: 0.55, sheetName: path.basename(filename) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createWindowListTemplate(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["ORDER NO", "", "", "", "DATE"],
    ["Client Name", "", "", "", "Client name"],
    ["Contact Details", "", "", "", ""],
    ["Address", "", "", "", ""],
    ["GSTIN", "", "", "", ""],
    ["Final Measurement Taken by / Check by", "", "", "", ""],
    ["Reference", "", "", "", ""],
    ["CONFIRMATION MADE BY", "", "", "", ""],
    ["DECISION GIVEN BY", "", "", "", ""],
    ["CHECKED BY", "", "", "", ""],
    ["FINAL MEASUREMENT DATE", "", "", "INSTALLATION DATE"],
    [],
    ["SR NO", "Location", "Width", "Height", "Total Sq Feet", "Qty", "Window Type", "Glass", "Lock Type", "Profile", "Mesh", "", "FINAL MEASUREMENT", "Total Sq Feet"],
    ["W1", "Living room", 1200, 1500, "", 1, "Sliding", "Clear toughened 8mm", "", "uPVC", "Fiber", "", "", ""],
    ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Client Name");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

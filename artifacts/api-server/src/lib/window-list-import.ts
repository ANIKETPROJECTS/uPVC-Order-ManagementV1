import * as XLSX from "xlsx";

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
  source: "excel";
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
        if (value) return value;
      }
    }
  }
  return "";
}

function parseSheet(sheet: XLSX.WorkSheet, sheetName: string): NormalizedWindowImport | null {
  const rows = realRows(sheet);
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
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer", raw: true, cellDates: false });
  } catch {
    throw new Error("The workbook could not be opened. Check that it is not password-protected or damaged.");
  }
  const names = selectedSheet ? [selectedSheet] : workbook.SheetNames;
  if (selectedSheet && !workbook.Sheets[selectedSheet]) throw new Error("The selected worksheet no longer exists. Choose a sheet and preview again.");
  const parsed = names.map((name) => parseSheet(workbook.Sheets[name], name)).filter((item): item is NormalizedWindowImport => item !== null);
  if (!parsed.length) throw new Error("Window table header not found. Expected SR NO, Width, Height, and Window Type.");
  return parsed;
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

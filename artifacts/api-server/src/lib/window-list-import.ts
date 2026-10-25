import * as XLSX from "xlsx";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalizeHeader, parseDocumentNumber } from "./document-extraction";

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
  originalCells: Array<{ columnLabel: string; text: string; page: number | null; rowPosition: number }>;
  page: number | null;
  confidence: number;
};

export type NormalizedWindowImport = {
  columns: string[];
  header: Record<string, string>;
  rows: WindowImportRow[];
  totals: { areaSqFt: number; quantity: number; sourceAreaSqFt: number | null; sourceQuantity: number | null };
  paymentSummary: Record<string, string>;
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
  return parseDocumentNumber(value);
}

function headerKey(value: unknown): keyof WindowImportRow | "finalMeasurement" | null {
  const key = normalized(value);
  for (const [field, pattern] of Object.entries(aliases)) {
    if (pattern.test(key)) return field as keyof WindowImportRow | "finalMeasurement";
  }
  const field = canonicalizeHeader(value).field;
  if (!field) return null;
  return ({
    serial: "windowNo",
    flat: "location",
    location: "location",
    width: "widthMm",
    height: "heightMm",
    quantity: "quantity",
    area: "areaSqFt",
    windowType: "windowType",
    glass: "glass",
    lockType: "lockType",
    profile: "profile",
    mesh: "mesh",
  } as const)[field] ?? null;
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
    if (!text(get("windowNo"))) rowWarnings.push("SR NO is blank; verify this row before importing.");
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
      originalCells: rows[rowIndex].flatMap((label, columnIndex) => {
        const columnLabel = text(label);
        return columnLabel ? [{
          columnLabel,
          text: text(row[columnIndex]),
          page: null,
          rowPosition: index + 1,
        }] : [];
      }),
      page: null,
      confidence: rowWarnings.length ? 0.7 : 0.95,
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
  const paymentSummary: Record<string, string> = {};
  const paymentLabels: Array<[string, RegExp]> = [
    ["Total sq ft", /^total\s*(?:sq\.?\s*(?:ft|feet)|square\s*feet)$/i],
    ["Rate", /^rate$/i], ["Increase Rate", /^increase\s*rate$/i], ["4 Track Charges", /^4\s*track\s*charges?$/i],
    ["Transport", /^transport$/i], ["CGST 9%", /^cgst\s*9\s*%?$/i], ["SGST 9%", /^sgst\s*9\s*%?$/i],
    ["Final Billing Amount", /^final\s*billing\s*(?:amount|amt\.?)$/i],
  ];
  for (const [label, matcher] of paymentLabels) {
    for (const row of rows) {
      const index = row.findIndex((cell) => matcher.test(normalized(cell)));
      if (index < 0) continue;
      if (label === "Total sq ft" && sourceAreaSqFt != null) paymentSummary[label] = String(sourceAreaSqFt);
      else {
        const value = row.slice(index + 1).find((cell) => text(cell) && !paymentLabels.some(([, other]) => other.test(normalized(cell))));
        if (value != null) paymentSummary[label] = text(value);
      }
      break;
    }
  }
  return { columns: rows[rowIndex].map(text).filter(Boolean), header, rows: importRows, totals: { areaSqFt, quantity: importRows.reduce((sum, row) => sum + row.quantity, 0), sourceAreaSqFt, sourceQuantity }, paymentSummary, warnings, source: "excel", confidence: importRows.length ? 0.95 : 0.2, sheetName };
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

type PdfWord = { xMin: number; xMax: number; yMin: number; yMax: number; text: string; page: number };
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
    const pages = [...stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gi)];
    const pageContent = pages.length ? pages.map((match) => match[1]) : [stdout];
    const pattern = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
    pageContent.forEach((content, page) => {
      for (const match of content.matchAll(pattern)) {
        const attrs = match[1];
        const xMin = Number(attrs.match(/\bxMin="([\d.]+)"/)?.[1]);
        const xMax = Number(attrs.match(/\bxMax="([\d.]+)"/)?.[1]);
        const yMin = Number(attrs.match(/\byMin="([\d.]+)"/)?.[1]);
        const yMax = Number(attrs.match(/\byMax="([\d.]+)"/)?.[1]);
        const value = decodeXml(match[2].replace(/<[^>]+>/g, "").trim());
        if ([xMin, xMax, yMin, yMax].every(Number.isFinite) && value) words.push({ xMin, xMax, yMin, yMax, text: value, page: page + 1 });
      }
    });
    if (words.length < 8) throw new Error("This PDF has no readable text layer. It may be scanned; no rows were guessed.");

    const lines: Array<{ y: number; page: number; words: PdfWord[] }> = [];
    for (const word of [...words].sort((a, b) => a.page - b.page || a.yMin - b.yMin || a.xMin - b.xMin)) {
      let line = lines.find((item) => item.page === word.page && Math.abs(item.y - word.yMin) <= 3.5);
      if (!line) { line = { y: word.yMin, page: word.page, words: [] }; lines.push(line); }
      line.words.push(word);
    }
    lines.sort((a, b) => a.page - b.page || a.y - b.y);
    lines.forEach((line) => line.words.sort((a, b) => a.xMin - b.xMin));
    const headerLine = lines.find((line) => {
      const joined = line.words.map((word) => normalized(word.text)).join(" ");
      return /\bsr\b/.test(joined) && /\blocation\b/.test(joined) && /\bwidth\b/.test(joined) && /\bheight\b/.test(joined);
    });
    if (!headerLine) throw new Error("The PDF window-table header could not be identified. Use Excel or check the PDF layout.");
    const headerWords = words.filter((word) => word.page === headerLine.page
      && word.yMin >= headerLine.y - 8 && word.yMin <= headerLine.y + 18);
    const headerGroups: Array<{ words: PdfWord[]; center: number }> = [];
    const headerLines: Array<{ y: number; words: PdfWord[] }> = [];
    for (const word of [...headerWords].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
      let line = headerLines.find((candidate) => Math.abs(candidate.y - word.yMin) <= 3.5);
      if (!line) { line = { y: word.yMin, words: [] }; headerLines.push(line); }
      line.words.push(word);
    }
    for (const line of headerLines) {
      const groups: PdfWord[][] = [];
      for (const word of line.words.sort((a, b) => a.xMin - b.xMin)) {
        const current = groups[groups.length - 1];
        if (!current || word.xMin - current[current.length - 1].xMax > 9) groups.push([word]);
        else current.push(word);
      }
      for (const group of groups) {
        const center = group.reduce((sum, word) => sum + (word.xMin + word.xMax) / 2, 0) / group.length;
        let target = headerGroups.find((candidate) => Math.abs(candidate.center - center) <= 18);
        if (!target) { target = { words: [], center }; headerGroups.push(target); }
        target.words.push(...group);
        target.center = target.words.reduce((sum, word) => sum + (word.xMin + word.xMax) / 2, 0) / target.words.length;
      }
    }
    const columns = headerGroups.map((group) => ({
      center: group.center,
      minX: Math.min(...group.words.map((word) => word.xMin)),
      maxX: Math.max(...group.words.map((word) => word.xMax)),
      label: group.words.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin).map((word) => word.text).join(" "),
      key: (() => {
        const key = normalized(group.words.map((word) => word.text).join(" "));
        if (/^sr\s*(?:no|number)?$/.test(key)) return "windowNo";
        if (/^location$|room\s*\/?\s*location/.test(key)) return "location";
        if (/^width/.test(key)) return "widthMm";
        if (/^height/.test(key)) return "heightMm";
        if (/sq\s*(?:ft|feet)|square\s*feet/.test(key)) return "areaSqFt";
        if (/^qty$|^quantity$/.test(key)) return "quantity";
        if (/window\s*type|^type$/.test(key)) return "windowType";
        if (/^glass/.test(key)) return "glass";
        if (/lock/.test(key)) return "lockType";
        if (/^profile$/.test(key)) return "profile";
        if (/^mesh/.test(key)) return "mesh";
        return `extra:${group.center.toFixed(2)}`;
      })(),
    })).sort((a, b) => a.center - b.center);
    if (columns.length < 7) throw new Error("The PDF window-table header could not be identified. Use Excel or check the PDF layout.");
    const bounds = columns.map((column, index) => ({
      left: index === 0 ? -Infinity : (columns[index - 1].maxX + column.minX) / 2,
      right: index === columns.length - 1 ? Infinity : (column.maxX + columns[index + 1].minX) / 2,
      ...column,
    }));
    const bucket = (word: PdfWord) => {
      const center = (word.xMin + word.xMax) / 2;
      return bounds.find((column) => center >= column.left && center < column.right) ?? bounds[bounds.length - 1];
    };
    const startY = Math.max(...headerWords.map((word) => word.yMax)) + 1;
    const afterHeaderWords = words.filter((word) => word.page > headerLine.page || (word.page === headerLine.page && word.yMin > startY));
    const totalWord = afterHeaderWords.find((word) => /^total$/i.test(word.text.trim()));
    const tableWords = totalWord
      ? afterHeaderWords.filter((word) => word.page < totalWord.page || (word.page === totalWord.page && word.yMin <= totalWord.yMin + 9))
      : afterHeaderWords;
    const perPage = new Map<number, PdfWord[]>();
    const dataWords = tableWords.filter((word) => !totalWord || word.page < totalWord.page || (word.page === totalWord.page && word.yMin < totalWord.yMin - 1));
    for (const word of dataWords) perPage.set(word.page, [...(perPage.get(word.page) ?? []), word]);
    const anchorsByPage = new Map<number, Array<{ word: PdfWord; y: number }>>();
    let sourceAreaSqFt: number | null = null;
    let sourceQuantity: number | null = null;
    if (totalWord) {
      const totalBand = afterHeaderWords.filter((word) => word.page === totalWord.page && Math.abs(word.yMin - totalWord.yMin) <= 9);
      sourceAreaSqFt = numeric(totalBand.filter((word) => bucket(word).key === "areaSqFt").map((word) => word.text).join(""));
      sourceQuantity = numeric(totalBand.filter((word) => bucket(word).key === "quantity").map((word) => word.text).join(""));
    }
    for (const [page, pageWords] of perPage) {
      const anchors = pageWords.filter((word) => {
        const column = bucket(word);
        return column.key === "windowNo" && /^(?:w)?\d{1,4}$/i.test(word.text.trim());
      }).sort((a, b) => a.yMin - b.yMin);
      anchorsByPage.set(page, anchors.map((word) => ({ word, y: (word.yMin + word.yMax) / 2 })));
    }
    const records: Array<{ page: number; position: number; words: PdfWord[] }> = [];
    for (const [page, anchors] of anchorsByPage) {
      anchors.forEach(({ y }, index) => {
        const previous = anchors[index - 1]?.y;
        const next = anchors[index + 1]?.y;
        const top = previous == null ? (page === headerLine.page ? startY : 0) : (previous + y) / 2;
        const bottom = next == null ? Infinity : (y + next) / 2;
        const pageWords = perPage.get(page) ?? [];
        const rowWords = pageWords.filter((word) => {
          const centerY = (word.yMin + word.yMax) / 2;
          return centerY >= top && centerY < bottom;
        });
        records.push({ page, position: y, words: rowWords });
      });
    }
    records.sort((a, b) => a.page - b.page || a.position - b.position);
    const recordPages = [...new Set(records.map((record) => record.page))].sort((a, b) => a - b);
    for (let pageIndex = 1; pageIndex < recordPages.length; pageIndex += 1) {
      const page = recordPages[pageIndex];
      const previousPage = recordPages[pageIndex - 1];
      const firstAnchor = anchorsByPage.get(page)?.[0];
      const previousRecord = records.filter((record) => record.page === previousPage).at(-1);
      if (!firstAnchor || !previousRecord) continue;
      const repeatedHeader = lines.find((line) => {
        if (line.page !== page || line.y >= firstAnchor.y) return false;
        const joined = line.words.map((word) => normalized(word.text)).join(" ");
        return /\bsr\b/.test(joined) && /\blocation\b/.test(joined) && /\bwidth\b/.test(joined) && /\bheight\b/.test(joined);
      });
      const continuationTop = repeatedHeader ? repeatedHeader.y + 20 : 35;
      const leading = (perPage.get(page) ?? []).filter((word) => {
        const y = (word.yMin + word.yMax) / 2;
        return y >= continuationTop && y < firstAnchor.y && bucket(word).key !== "windowNo";
      });
      if (leading.length) previousRecord.words.push(...leading);
    }
    const rows: WindowImportRow[] = records.map((record, index) => {
      const cellMap = new Map<string, string[]>();
      for (const word of record.words) {
        const key = bucket(word).key;
        cellMap.set(key, [...(cellMap.get(key) ?? []), word.text]);
      }
      const orderedCells = bounds.map((column) => ({
        columnLabel: column.label,
        text: (cellMap.get(column.key) ?? []).join(" ").trim(),
        page: record.page,
        rowPosition: Math.round(record.position * 100) / 100,
      }));
      const raw = (key: string) => {
        const columnIndex = bounds.findIndex((column) => column.key === key);
        return columnIndex < 0 ? "" : orderedCells[columnIndex]?.text ?? "";
      };
      const widthMm = numeric(raw("widthMm")), heightMm = numeric(raw("heightMm")), parsedQuantity = numeric(raw("quantity"));
      const quantity = parsedQuantity ?? 1;
      const sourceArea = numeric(raw("areaSqFt"));
      const computed = widthMm != null && heightMm != null ? widthMm * heightMm * quantity / 92903.04 : null;
      const rowWarnings: string[] = [];
      if (widthMm == null || heightMm == null) rowWarnings.push("Width or height is missing or invalid.");
      if (parsedQuantity == null) rowWarnings.push("Quantity is missing or invalid.");
      if (!raw("windowNo")) rowWarnings.push("SR NO is blank; verify this row.");
      if (!raw("windowType")) rowWarnings.push("Window type is missing.");
      if (sourceArea != null && computed != null && computed > 0 && Math.abs(sourceArea - computed) / computed > 0.005) rowWarnings.push("Document area differs from width × height × quantity by more than 0.5%.");
      if (/\b(?:TOUCH\s+LOCK|UPVC|(?:\d+\s*MM\s+CLEAR))\b/i.test(raw("windowType"))) rowWarnings.push("Window Type contains text that may belong to a neighboring column.");
      const normalizedField = (key: string) => raw(key);
      return {
        sourceRow: index + 1,
        windowNo: raw("windowNo"), location: raw("location"), widthMm, heightMm,
        areaSqFt: sourceArea ?? computed, quantity, windowType: normalizedField("windowType"),
        glass: normalizedField("glass"), lockType: normalizedField("lockType"),
        profile: normalizedField("profile"), mesh: normalizedField("mesh"),
        finalMeasurementSqFt: null, warnings: rowWarnings, originalCells: orderedCells,
        page: record.page, confidence: rowWarnings.length ? 0.7 : 0.95,
      };
    });
    const areaSqFt = rows.reduce((sum, row) => sum + (row.areaSqFt ?? 0), 0);
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const warnings = ["PDF import, please verify."];
    if (sourceQuantity != null && sourceQuantity !== quantity) warnings.push(`Parsed quantity ${quantity} does not match PDF TOTAL quantity ${sourceQuantity}.`);
    if (sourceAreaSqFt != null && areaSqFt > 0 && Math.abs(sourceAreaSqFt - areaSqFt) / areaSqFt > 0.005) warnings.push(`Recomputed area ${areaSqFt.toFixed(2)} sq ft does not match PDF TOTAL ${sourceAreaSqFt.toFixed(2)} sq ft.`);
    if (!rows.length) warnings.push("No rows were found between the table header and TOTAL row.");
    const seen = new Set<string>();
    for (const row of rows) {
      const key = row.windowNo.toLocaleLowerCase();
      if (key && seen.has(key)) row.warnings.push("Duplicate window number.");
      if (key) seen.add(key);
      row.confidence = row.warnings.length ? 0.7 : 0.95;
    }
    return { columns: columns.map((column) => column.label), header: {}, rows, totals: { areaSqFt, quantity, sourceAreaSqFt, sourceQuantity }, paymentSummary: {}, warnings, source: "pdf", confidence: rows.length ? 0.9 : 0.2, sheetName: path.basename(filename) };
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

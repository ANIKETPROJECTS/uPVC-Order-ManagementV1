import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface ParsedGlassWorkbookItem {
  id: string;
  villaNo: string | null;
  windowNo: string;
  glassType: string;
  widthMm: number;
  heightMm: number;
  ordered: number;
  sourceRow: number;
  warnings: string[];
  rawValues: string[];
}

export interface GlassWorkbookColumnMapping {
  width: number | null;
  height: number | null;
  quantity: number | null;
  serial: number | null;
  flat: number | null;
}

export interface ParsedGlassWorkbookSection {
  clientLabel: string;
  glassType: string;
  lot: string | null;
  wing: string | null;
  date: string | null;
  supplier: string | null;
  sourceSheet: string;
  sourceRowStart: number;
  sourceRowEnd: number;
  warnings: string[];
  needsAttention: boolean;
  columns: string[];
  mapping: GlassWorkbookColumnMapping;
  items: ParsedGlassWorkbookItem[];
}

const MAX_SECTIONS = 100;
const MAX_ITEMS = 5000;
type Row = { excelRow: number; cells: unknown[] };
type Columns = { sr: number; flat: number; width: number; height: number; qty: number; glass: number; headerRow: number };

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value == null ? "" : String(value).trim().replace(/\s+/g, " ");
}
function key(value: unknown): string { return text(value).toLocaleLowerCase().replace(/[.\s_-]+/g, " ").trim(); }
function number(value: unknown): number | null {
  const parsed = Number(text(value).replace(/,/g, "").replace(/[^\d.+-]/g, ""));
  return text(value) && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function quantity(value: unknown): number | null {
  if (value == null || text(value) === "") return 1;
  const match = /^\s*(\d+)\s*(?:nos?|pcs?|pieces?)?\s*$/i.exec(text(value));
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function isDate(value: unknown): boolean {
  if (value instanceof Date && Number.isFinite(value.getTime())) return true;
  const valueText = text(value);
  return /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(valueText)
    || /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(valueText)
    || /^\d{4}-\d{2}-\d{2}T/.test(valueText);
}
function populated(value: unknown): boolean { return text(value) !== ""; }
function dateLabel(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const candidate = text(value);
  return isDate(value) ? candidate : null;
}
function supplierLabel(value: string): boolean {
  return /\b(saint\s*gobain|saint-gobain|asahi|guardian|gold\s*plus|glass\s*vendor|supplier)\b/i.test(value);
}
function isGlassType(value: string): boolean {
  return /(?:\d+(?:\.\d+)?\s*mm\b.*(?:glass|toughened|frosted|clear)|\b(?:clear|toughened|frosted|laminated|reflective)\s+glass\b)/i.test(value);
}

function actualRows(sheet: XLSX.WorkSheet): Row[] {
  const cells = new Map<number, Map<number, unknown>>();
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    let point: XLSX.CellAddress;
    try { point = XLSX.utils.decode_cell(address); } catch { continue; }
    const value = (sheet[address] as XLSX.CellObject | undefined)?.v;
    if (!populated(value)) continue;
    const row = cells.get(point.r) ?? new Map<number, unknown>();
    row.set(point.c, value);
    cells.set(point.r, row);
  }
  const maxRow = Math.max(-1, ...cells.keys());
  const maxColumn = Math.max(-1, ...[...cells.values()].flatMap((row) => [...row.keys()]));
  return Array.from({ length: maxRow + 1 }, (_, index) => ({
    excelRow: index + 1,
    cells: Array.from({ length: maxColumn + 1 }, (_, column) => cells.get(index)?.get(column) ?? null),
  }));
}

function mergedTopLeftValue(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number): unknown {
  const range = sheet["!merges"]?.find(({ s, e }) =>
    rowIndex >= s.r && rowIndex <= e.r && columnIndex >= s.c && columnIndex <= e.c,
  );
  if (!range) return undefined;
  return sheet[XLSX.utils.encode_cell(range.s)]?.v;
}

function findColumns(rows: Row[], start = 0): Columns | null {
  for (let rowIndex = start; rowIndex < rows.length; rowIndex += 1) {
    const labels = rows[rowIndex].cells.map(key);
    const width = labels.findIndex((label) => ["w", "width", "width mm", "width mm"].includes(label));
    const height = labels.findIndex((label) => ["h", "height", "height mm"].includes(label));
    if (width < 0 || height < 0) continue;
    const find = (names: string[]) => labels.findIndex((label) => names.includes(label));
    let sr = find(["sr no", "s no", "serial", "serial number"]);
    if (sr < 0 && rowIndex > 0) sr = rows[rowIndex - 1].cells.map(key).findIndex((label) => ["sr no", "s no", "serial", "serial number"].includes(label));
    let flat = find(["flat", "flat no", "unit", "room", "villa", "villa no"]);
    if (flat < 0 && rowIndex > 0) flat = rows[rowIndex - 1].cells.map(key).findIndex((label) => ["flat", "flat no", "unit", "room", "villa", "villa no"].includes(label));
    let qty = find(["qty", "quantity", "nos", "pieces"]);
    if (qty < 0) {
      const candidate = Math.max(width, height) + 1;
      if (rows.slice(rowIndex + 1, rowIndex + 6).some((row) => quantity(row.cells[candidate]) !== null && populated(row.cells[candidate]))) qty = candidate;
    }
    const glass = labels.findIndex((label) => label.includes("glass") && !["glass", "glass type"].includes(label));
    return { sr, flat, width, height, qty, glass, headerRow: rowIndex };
  }
  return null;
}

function looksLikeNewBlock(rows: Row[], index: number): boolean {
  const row = rows[index];
  if (!row?.cells.some(populated) || row.cells.some((value) => number(value) != null)) return false;
  const hasValidTitle = row.cells.some((value) => {
    const candidate = text(value);
    const normalized = key(candidate);
    return candidate.length > 1 && !isDate(value) && !/^\d+$/.test(candidate)
      && !["glass", "villa no", "flat no", "sr no", "s no", "serial", "w", "h", "width", "height"].includes(normalized)
      && !/^\d+(?:\.\d+)?\s*mm\b/i.test(candidate)
      && !/glass$/i.test(candidate);
  });
  if (!hasValidTitle) return false;
  for (let next = index + 1; next < Math.min(rows.length, index + 5); next += 1) {
    if (findColumns(rows, next)) return true;
    if (rows[next].cells.some((value) => number(value) != null)) return false;
  }
  return false;
}

function splitBlocks(rows: Row[]): Row[][] {
  const blocks: Row[][] = [];
  let current: Row[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.cells.some(populated)) {
      if (!current.length) continue;
      let next = index + 1;
      while (next < rows.length && !rows[next].cells.some(populated)) next += 1;
      const columns = findColumns(current);
      const previousData = columns && number(current.at(-1)?.cells[columns.width]) != null && number(current.at(-1)?.cells[columns.height]) != null;
      const nextData = columns && number(rows[next]?.cells[columns.width]) != null && number(rows[next]?.cells[columns.height]) != null;
      if (previousData && nextData) { current.push(row); continue; }
      blocks.push(current);
      current = [];
      continue;
    }
    if (current.length && looksLikeNewBlock(rows, index) && current.some((candidate) => {
      const columns = findColumns(current);
      return columns && number(candidate.cells[columns.width]) != null && number(candidate.cells[columns.height]) != null;
    })) {
      blocks.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function stableId(
  sheet: string, row: number, client: string, glass: string,
  flat: string | null, serial: string, width: number, height: number,
): string {
  return createHash("sha256").update([sheet, row, key(client), key(glass), key(flat ?? ""), key(serial), width, height].join("|")).digest("hex").slice(0, 32);
}

export async function parseGlassOrderWorkbook(bytes: Buffer, mappingOverrides: GlassWorkbookColumnMapping[] = []): Promise<ParsedGlassWorkbookSection[]> {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, raw: true });
  const sections: ParsedGlassWorkbookSection[] = [];
  let itemCount = 0;
  let previousClient = "";
  for (const sheetName of workbook.SheetNames) {
    const rows = actualRows(workbook.Sheets[sheetName]);
    for (const block of splitBlocks(rows)) {
      const detected = findColumns(block);
      if (!detected) continue;
      const tableRows = block.slice(detected.headerRow);
      const sourceColumnIndexes = Array.from({ length: Math.max(0, ...tableRows.flatMap((row) => row.cells.flatMap((cell, index) => populated(cell) ? [index + 1] : []))) }, (_, index) => index)
        .filter((index) => populated(block[detected.headerRow].cells[index]) || tableRows.some((row) => populated(row.cells[index])));
      const physicalColumn = (index: number | null) => index == null ? -1 : sourceColumnIndexes[index] ?? -1;
      const override = mappingOverrides[sections.length];
      const columns: Columns = override ? {
        ...detected,
        width: physicalColumn(override.width),
        height: physicalColumn(override.height),
        qty: physicalColumn(override.quantity),
        sr: physicalColumn(override.serial),
        flat: physicalColumn(override.flat),
      } : detected;
      const headerRow = block[columns.headerRow];
      const rawColumnLabels = sourceColumnIndexes.map((index) => {
        const value = populated(headerRow.cells[index])
          ? headerRow.cells[index]
          : mergedTopLeftValue(workbook.Sheets[sheetName], headerRow.excelRow - 1, index);
        return String(value ?? "").trim();
      });
      const columnLabels = rawColumnLabels.map((label, index) => label || (
        sourceColumnIndexes[index] === columns.qty ? "Qty" : `Column ${XLSX.utils.encode_col(sourceColumnIndexes[index])}`
      ));
      const titleRows = block.slice(0, columns.headerRow);
      const titleValues = titleRows.flatMap((row) => row.cells.filter(populated));
      const ownClientLabel = titleValues.map(text).find((value, index) => {
        const keyValue = key(value);
        const previousLine = text(titleValues[index - 1]);
        return value.length > 1 && !isDate(value) && !/^\d+$/.test(value)
        && !["glass", "w", "h", "sr no", "s no", "serial", "flat no", "villa no", "unit", "room", "lot", "wing"].includes(keyValue)
          && !/\b(?:lot|wing)\b/i.test(value)
          && !/^\d+(?:\.\d+)?\s*mm\b/i.test(value)
          && !supplierLabel(value)
          && !isGlassType(value)
          && !(previousLine && /glass$/i.test(value) && !/^glass$/i.test(value));
      }) ?? "";
      const carriedForwardClient = !ownClientLabel && Boolean(previousClient);
      let clientLabel = ownClientLabel || previousClient;
      if (!clientLabel) {
        const start = block[0]?.excelRow ?? 1;
        throw new Error(`${sheetName}, row ${start}: client name could not be identified. Add a client heading before the glass table.`);
      }
      previousClient = clientLabel;
      const glassType = (columns.glass >= 0 ? text(block[columns.headerRow].cells[columns.glass]) : "")
        || titleValues.map(text).find(isGlassType)
        || "Glass type not identified";
      const lot = titleValues.map(text).find((value) => /\b\d+(?:st|nd|rd|th)?\s*lot\b|\blot\s*\d+\b/i.test(value)) ?? null;
      const wing = titleValues.map(text).find((value) => /\b[\w-]+\s*wing\b/i.test(value)) ?? null;
      const date = titleValues.map((value) => dateLabel(value)).find((value) => value !== null) ?? null;
      const supplier = titleValues.map(text).find(supplierLabel) ?? null;
      const sectionWarnings: string[] = [];
      if (!clientLabel) sectionWarnings.push("Client name is missing.");
      if (clientLabel.length < 4) sectionWarnings.push("Client name is very short.");
      if (carriedForwardClient) sectionWarnings.push("Client name was carried forward from the previous group.");
      if (glassType === "Glass type not identified") sectionWarnings.push("Glass type could not be identified.");
      if (columns.width < 0) sectionWarnings.push("Width column is not mapped.");
      if (columns.height < 0) sectionWarnings.push("Height column is not mapped.");
      if (columns.qty < 0) sectionWarnings.push("Quantity column is not mapped.");
      const groupKey = `${sheetName}:${block[0]?.excelRow ?? 1}:${sections.length}`;
      const items: ParsedGlassWorkbookItem[] = [];
      for (const row of block.slice(columns.headerRow + 1)) {
        const widthMm = columns.width < 0 ? null : number(row.cells[columns.width]);
        const heightMm = columns.height < 0 ? null : number(row.cells[columns.height]);
        const anyCells = row.cells.some(populated);
        if (!anyCells) continue;
        if (widthMm == null && heightMm == null) {
          if ([columns.sr, columns.flat, columns.qty].some((column) => column >= 0 && populated(row.cells[column]))) {
            throw new Error(`${sheetName}, row ${row.excelRow}: this measurement row has no valid width or height.`);
          }
          continue;
        }
        if (widthMm == null || heightMm == null) {
          throw new Error(`${sheetName}, row ${row.excelRow}: width or height is missing or invalid.`);
        }
        const ordered = columns.qty >= 0 ? quantity(row.cells[columns.qty]) : 1;
        if (ordered == null) throw new Error(`${sheetName}, row ${row.excelRow}: invalid quantity.`);
        const serial = columns.sr >= 0 ? text(row.cells[columns.sr]) : "";
        const flat = columns.flat >= 0 ? text(row.cells[columns.flat]) || null : null;
        const windowNo = serial || `Row ${row.excelRow}`;
        const warnings = serial ? [] : [`Window number was inferred from Excel row ${row.excelRow}.`];
        items.push({
          id: stableId(groupKey, row.excelRow, clientLabel, glassType, flat, windowNo, widthMm, heightMm),
          villaNo: flat,
          windowNo,
          glassType,
          widthMm,
          heightMm,
          ordered,
          sourceRow: row.excelRow,
          warnings,
          rawValues: sourceColumnIndexes.map((sourceIndex) => {
            const value = row.cells[sourceIndex];
            return value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? "" : String(value).trim();
          }),
        });
      }
      if (items.length) {
        const dataRows = block.slice(columns.headerRow + 1).filter((row) =>
          number(row.cells[columns.width]) !== null || number(row.cells[columns.height]) !== null,
        );
        sections.push({
          clientLabel,
          glassType,
          lot,
          wing,
          date,
          supplier,
          sourceSheet: sheetName,
          sourceRowStart: dataRows[0]?.excelRow ?? block[columns.headerRow].excelRow,
          sourceRowEnd: dataRows.at(-1)?.excelRow ?? block[columns.headerRow].excelRow,
          warnings: sectionWarnings,
          needsAttention: sectionWarnings.length > 0 || items.some((item) => item.warnings.length > 0),
          columns: columnLabels,
          mapping: {
            width: columns.width >= 0 ? sourceColumnIndexes.indexOf(columns.width) : null,
            height: columns.height >= 0 ? sourceColumnIndexes.indexOf(columns.height) : null,
            quantity: columns.qty >= 0 ? sourceColumnIndexes.indexOf(columns.qty) : null,
            serial: columns.sr >= 0 ? sourceColumnIndexes.indexOf(columns.sr) : null,
            flat: columns.flat >= 0 ? sourceColumnIndexes.indexOf(columns.flat) : null,
          },
          items,
        });
        itemCount += items.length;
        if (sections.length > MAX_SECTIONS || itemCount > MAX_ITEMS) throw new Error("This workbook exceeds the supported number of glass groups or rows.");
      }
    }
  }
  if (!sections.length) throw new Error("No glass rows were found. Include client headings, glass types, W/H headers, and measurement rows.");
  return sections;
}

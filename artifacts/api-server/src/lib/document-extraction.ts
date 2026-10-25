import * as XLSX from "xlsx";

export type ExtractionSource = "pdf" | "excel" | "csv";
export type ExtractionStatus = "verified" | "needs_review" | "failed";
export type CanonicalField =
  | "serial" | "flat" | "location" | "width" | "height" | "quantity"
  | "area" | "windowType" | "glass" | "lockType" | "profile" | "mesh";

export type ExtractionCell = {
  text: string;
  parsed: string | number | boolean | null;
};

export type ExtractionColumn = {
  label: string;
  canonicalField: CanonicalField | null;
  confidence: number;
};

export type ExtractionRow = {
  cells: ExtractionCell[];
  page: number | null;
  sheet: string | null;
  rowRef: string;
  warnings: string[];
  confidence: number;
};

export type ExtractionTable = {
  title: string | null;
  columns: ExtractionColumn[];
  rows: ExtractionRow[];
  totalsRow: ExtractionRow | null;
  warnings: string[];
  confidence: number;
};

export type ExtractionDocument = {
  source: ExtractionSource;
  pages: number[];
  sheets: string[];
  keyValues: Array<{ label: string; value: string }>;
  tables: ExtractionTable[];
  textBlocks: string[];
  warnings: string[];
  overallStatus: ExtractionStatus;
  confidence: number;
};

export type SpreadsheetGrid = {
  name: string;
  rows: Array<{ rowNumber: number; cells: string[] }>;
};

export type SynonymDictionary = Partial<Record<CanonicalField, string[]>>;

export const DEFAULT_SYNONYMS: Record<CanonicalField, string[]> = {
  serial: ["sr no", "sr.no", "s no", "serial", "serial no", "serial number", "window", "window no", "id"],
  flat: ["flat", "flat no", "unit", "room", "villa", "villa no"],
  location: ["location", "room location", "room / location"],
  width: ["w", "width", "wd", "width mm", "width (mm)", "breadth"],
  height: ["h", "ht", "height", "height mm", "height (mm)"],
  quantity: ["qty", "quantity", "nos", "pcs", "pieces", "no of pieces"],
  area: ["sq ft", "sq. ft", "sq feet", "square feet", "total sq feet", "area"],
  windowType: ["window type", "type"],
  glass: ["glass", "glass type"],
  lockType: ["lock", "lock type"],
  profile: ["profile"],
  mesh: ["mesh", "mesh type"],
};

export function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function canonicalizeHeader(
  value: unknown,
  synonyms: SynonymDictionary = {},
): { field: CanonicalField | null; confidence: number } {
  const label = normalizeLabel(value);
  if (!label) return { field: null, confidence: 0 };
  let best: { field: CanonicalField | null; confidence: number } = { field: null, confidence: 0 };
  for (const field of Object.keys(DEFAULT_SYNONYMS) as CanonicalField[]) {
    const names = [...DEFAULT_SYNONYMS[field], ...(synonyms[field] ?? [])].map(normalizeLabel);
    for (const name of names) {
      const confidence = label === name ? 1 : label.includes(name) || name.includes(label) ? 0.85
        : Math.max(label.length, name.length) >= 5 && editDistance(label, name) <= 1 ? 0.72 : 0;
      if (confidence > best.confidence) best = { field, confidence };
    }
  }
  return best;
}

export function parseDocumentNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const percent = /%/.test(text);
  const numeric = text
    .replace(/(?:₹|rs\.?|inr)/gi, "")
    .replace(/,/g, "")
    .replace(/(?:mm|sq\.?\s*ft|sq\.?\s*feet|nos?|pcs?|pieces?)\b/gi, "")
    .replace(/[^\d.+-]/g, "");
  if (!numeric || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) return null;
  const result = Number(numeric);
  return Number.isFinite(result) ? (percent ? result / 100 : result) : null;
}

export function parseDocumentDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) && /\d/.test(text) ? parsed.toISOString().slice(0, 10) : null;
}

export function readSpreadsheetGrids(bytes: Buffer): SpreadsheetGrid[] {
  const workbook = XLSX.read(bytes, { type: "buffer", raw: true, cellDates: true });
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return [];
    const cells = Object.keys(sheet).flatMap((address) => {
      if (address.startsWith("!")) return [];
      try {
        const point = XLSX.utils.decode_cell(address);
        return [{ address, row: point.r, column: point.c, value: (sheet[address] as XLSX.CellObject).v }];
      } catch { return []; }
    });
    if (!cells.length) return [{ name, rows: [] }];
    const maxRow = Math.max(...cells.map((cell) => cell.row));
    const maxColumn = Math.max(...cells.map((cell) => cell.column));
    const grid = Array.from({ length: maxRow + 1 }, () => Array<string>(maxColumn + 1).fill(""));
    for (const cell of cells) {
      const isHidden = sheet["!rows"]?.[cell.row]?.hidden;
      if (!isHidden) grid[cell.row][cell.column] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.value ?? "");
    }
    for (const merge of sheet["!merges"] ?? []) {
      const topLeft = grid[merge.s.r]?.[merge.s.c] ?? "";
      for (let row = merge.s.r; row <= merge.e.r; row += 1) {
        for (let column = merge.s.c; column <= merge.e.c; column += 1) {
          if (!grid[row]?.[column]) grid[row][column] = topLeft;
        }
      }
    }
    const rows = grid.flatMap((row, index) => {
      if (sheet["!rows"]?.[index]?.hidden || !row.some((cell) => cell.trim())) return [];
      return [{ rowNumber: index + 1, cells: row }];
    });
    return [{ name, rows }];
  });
}

export function checkExtractionTable(table: ExtractionTable): ExtractionTable {
  const warnings = [...table.warnings];
  const fields = new Map(table.columns.map((column, index) => [column.canonicalField, index]));
  const serialIndex = fields.get("serial");
  const widthIndex = fields.get("width");
  const heightIndex = fields.get("height");
  const quantityIndex = fields.get("quantity");
  const areaIndex = fields.get("area");
  const seen = new Set<string>();
  let lowConfidence = table.columns.some((column) => column.confidence < 0.8);
  const rows = table.rows.map((row) => {
    const rowWarnings = [...row.warnings];
    const value = (index: number | undefined) => index == null ? null : row.cells[index]?.parsed;
    if (serialIndex != null) {
      const id = normalizeLabel(value(serialIndex));
      if (!id) rowWarnings.push("Required identifier is blank.");
      else if (seen.has(id)) rowWarnings.push("Duplicate identifier.");
      seen.add(id);
    }
    for (const field of ["width", "height", "quantity"] as const) {
      const index = fields.get(field);
      if (index != null && parseDocumentNumber(value(index)) == null) rowWarnings.push(`Required ${field} is missing or not numeric.`);
    }
    const width = parseDocumentNumber(value(widthIndex));
    const height = parseDocumentNumber(value(heightIndex));
    const qty = parseDocumentNumber(value(quantityIndex));
    const area = parseDocumentNumber(value(areaIndex));
    if (width != null && height != null && qty != null && area != null && area > 0) {
      const computed = width * height * qty / 92903.04;
      if (Math.abs(area - computed) / computed > 0.005) rowWarnings.push("Printed area differs from width × height × quantity by more than 0.5%.");
    }
    const confidence = Math.min(row.confidence, rowWarnings.length ? 0.7 : 0.95);
    lowConfidence ||= confidence < 0.8;
    return { ...row, warnings: [...new Set(rowWarnings)], confidence };
  });
  const status: ExtractionStatus = !table.columns.length || !rows.length ? "failed" : (warnings.length > 0 || lowConfidence || rows.some((row) => row.warnings.length > 0) ? "needs_review" : "verified");
  return { ...table, rows, warnings: [...new Set(warnings)], confidence: lowConfidence ? Math.min(table.confidence, 0.7) : table.confidence };
}


import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";

export interface ParsedGlassWorkbookItem {
  id: string;
  villaNo: string | null;
  windowNo: string;
  glassType: string;
  widthMm: number;
  heightMm: number;
  ordered: number;
}

export interface ParsedGlassWorkbookSection {
  clientLabel: string;
  items: ParsedGlassWorkbookItem[];
}

const MAX_SECTIONS = 100;
const MAX_ITEMS = 5000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const text = cellText(value).replace(/,/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseQuantity(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const match = /^\s*(\d+)\s*(?:nos?|pcs?|pieces?)?\s*$/i.exec(cellText(value));
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function isClientHeading(row: unknown[]): string | null {
  const populated = row
    .map((value, index) => ({ value: cellText(value), index }))
    .filter((cell) => cell.value);
  if (populated.length !== 1) return null;

  const label = populated[0].value;
  const key = normalized(label);
  if (["w", "h", "sr no", "sr. no", "villa no."].includes(key)) return null;
  return label;
}

function itemId(
  clientLabel: string,
  glassType: string,
  villaNo: string | null,
  windowNo: string,
  widthMm: number,
  heightMm: number,
): string {
  const stableKey = [
    normalized(clientLabel),
    normalized(glassType),
    normalized(villaNo ?? ""),
    normalized(windowNo),
    widthMm,
    heightMm,
  ].join("|");
  return createHash("sha256").update(stableKey).digest("hex").slice(0, 32);
}

export async function parseGlassOrderWorkbook(
  bytes: Buffer,
): Promise<ParsedGlassWorkbookSection[]> {
  const readAllSheets = readXlsxFile as unknown as (
    workbook: Buffer,
    options: { getSheets: true },
  ) => Promise<Array<{ sheet: string; data: unknown[][] }>>;
  const sheets = await readAllSheets(bytes, { getSheets: true });
  const sections = new Map<string, ParsedGlassWorkbookSection>();
  const itemIndexes = new Map<string, Map<string, ParsedGlassWorkbookItem>>();
  let currentClientLabel = "";
  let currentGlassType = "";
  let parsedItemCount = 0;

  for (const sheet of sheets) {
    for (const row of sheet.data as unknown[][]) {
      const heading = isClientHeading(row);
      if (heading) {
        currentClientLabel = heading;
        currentGlassType = "";
        const clientKey = normalized(heading);
        if (!sections.has(clientKey)) {
          if (sections.size >= MAX_SECTIONS) {
            throw new Error(`This workbook contains more than ${MAX_SECTIONS} client sections.`);
          }
          sections.set(clientKey, { clientLabel: heading, items: [] });
          itemIndexes.set(clientKey, new Map());
        }
        continue;
      }

      const serialHeader = normalized(cellText(row[1]));
      const possibleGlassType = cellText(row[2]);
      if (/^(?:sr\.?\s*no\.?|serial\s*(?:number|no\.?)?)$/i.test(serialHeader) && possibleGlassType) {
        currentGlassType = possibleGlassType;
        continue;
      }

      const widthMm = parsePositiveNumber(row[2]);
      const heightMm = parsePositiveNumber(row[3]);
      if (widthMm === null || heightMm === null || !currentGlassType) continue;

      if (!currentClientLabel) {
        throw new Error("Add a client or project heading above each glass section before importing.");
      }

      const ordered = parseQuantity(row[4]);
      if (ordered === null) {
        throw new Error(
          `A glass row for “${currentClientLabel}” has no valid piece quantity. Use whole quantities such as “2nos”.`,
        );
      }

      parsedItemCount += 1;
      if (parsedItemCount > MAX_ITEMS) {
        throw new Error(`This workbook contains more than ${MAX_ITEMS} glass rows.`);
      }

      const villaText = cellText(row[0]);
      const villaNo = villaText || null;
      const windowNo = cellText(row[1]) || (villaNo ? "Unnumbered" : "Unspecified");
      const id = itemId(
        currentClientLabel,
        currentGlassType,
        villaNo,
        windowNo,
        widthMm,
        heightMm,
      );
      const clientKey = normalized(currentClientLabel);
      const section = sections.get(clientKey)!;
      const items = itemIndexes.get(clientKey)!;
      const existing = items.get(id);

      if (existing) {
        existing.ordered += ordered;
      } else {
        const item: ParsedGlassWorkbookItem = {
          id,
          villaNo,
          windowNo,
          glassType: currentGlassType,
          widthMm,
          heightMm,
          ordered,
        };
        items.set(id, item);
        section.items.push(item);
      }
    }
  }

  const parsedSections = [...sections.values()].filter((section) => section.items.length > 0);
  if (!parsedSections.length) {
    throw new Error(
      "No glass rows were found. Use client headings, glass-type headers, width/height columns, and quantities such as “2nos”.",
    );
  }
  return parsedSections;
}

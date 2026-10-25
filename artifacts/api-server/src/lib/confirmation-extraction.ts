import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseWindowListPdf, parseWindowListWorkbook, type NormalizedWindowImport } from "./window-list-import";

const execFile = promisify(execFileCallback);

export type ConfirmationInfo = {
  status: "extracted" | "no_text" | "unsupported" | "failed";
  method: "pdf_text" | "ocr" | "none";
  extractedAt: string;
  sections: Array<{ title: string; fields: Array<{ label: string; value: string }> }>;
  windows: Array<{ windowNo: string; location: string; width: string; height: string; area: string; quantity: string; windowType: string; glass: string; lockType: string; profile: string; mesh: string; originalCells?: Array<{ columnLabel: string; text: string; page: number | null; rowPosition: number }>; page?: number | null; rowPosition?: number; warnings?: string[]; confidence?: number }>;
  columns?: string[];
  checksum?: { rowsFound: number; quantity: number; calculatedAreaSqFt: number; documentAreaSqFt: number | null; matches: boolean | null };
  terms: string[];
  rawText: string;
  error: string | null;
};

const fieldGroups: Array<{ title: string; fields: Array<[string, RegExp]> }> = [
  { title: "Order and confirmation", fields: [
    ["Supplier / company", /^\s*([A-Z][A-Z &.'-]{3,})\s*$/m],
    ["Order number", /^\s*ORDER\s*(?:NO|NUMBER|ID)\s*:?\s*(.+?)(?:\s{2,}DATE\s*:.*)?\s*$/im],
    ["Confirmation date", /^\s*ORDER\s*(?:NO|NUMBER|ID)\s*:?\s*[^\s]+\s{2,}DATE\s*:?\s*([A-Za-z0-9/-]+)/im],
    ["Final measurement date", /^\s*FINAL\s+MEASUREMENT\s+DATE\s*:?\s*(.*?)\s*$/im],
    ["Installation date / schedule", /^\s*INSTALLATION\s+DATE\s*:?\s*(.*?)\s*$/im],
    ["Reference", /^\s*REFERENCE\s*:?\s*(.*?)\s*$/im],
  ] },
  { title: "Client details", fields: [
    ["Client name", /^\s*CLIENT\s+NAME\s*:?\s*(.*?)\s*$/im],
    ["Contact details", /^\s*CONTACT\s+DETAILS\s*:?\s*(.*?)\s*$/im],
    ["Address", /^\s*ADDRESS\s*:?\s*(.*?)\s*$/im],
    ["GSTIN", /^\s*GSTIN\s*:?\s*(.*?)\s*$/im],
    ["Final measurement taken / checked by", /^\s*FINAL\s+MEASUR(?:E)?MENT\s+TAKEN\s+BY\s*\/?\s*CHECK\s+BY\s*:?\s*(.*?)\s*$/im],
    ["Confirmation made by", /^\s*CONFIRMATION\s+MADE\s+BY\s*:?\s*(.*?)\s*$/im],
    ["Decision given by", /^\s*DECISION\s+GIVEN\s+BY\s*:?\s*(.*?)\s*$/im],
    ["Checked by", /^\s*CHECKED\s+BY\s*:?\s*(.*?)\s*$/im],
  ] },
  { title: "Window and order totals", fields: [
    ["Total area (sq ft)", /^\s*TOTAL\s+([\d,.]+)\s+[\d,.]+/im],
    ["Total window quantity", /^\s*TOTAL\s+[\d,.]+\s+([\d,.]+)/im],
    ["Rate", /^\s*RATE\s*:?\s*₹?\s*([\d,.]+)\s*$/im],
    ["Basic amount", /^\s*BASIC\s*:?\s*₹?\s*([\d,.]+)\s*$/im],
    ["CGST", /^\s*CGST\s*(?:\d+(?:\.\d+)?%\s*)?:?\s*₹?\s*([\d,.]+)\s*$/im],
    ["SGST", /^\s*SGST\s*(?:\d+(?:\.\d+)?%\s*)?:?\s*₹?\s*([\d,.]+)\s*$/im],
    ["Final billing amount", /^\s*FINAL\s+BILLING\s+AMT\.?\s*:?\s*₹?\s*([\d,.]+)\s*$/im],
    ["Advance payment terms", /^\s*(\d{1,3}%\s+ADVANCE\s+PAYMENT)\b/im],
  ] },
  { title: "Contacts and banking", fields: [
    ["Accounts contact", /^\s*ACCOUNTS\s+CONTACT\s+NO\s*:?\s*(.*?)\s*$/im],
    ["Production contact", /^\s*PRODUCTION\s+CONTACT\s+NO\s*:?\s*(.*?)\s*$/im],
    ["Account holder", /^\s*AC(?:COUNT)?\s+HOLDER\s+NAME\s*:?\s*(.*?)\s*$/im],
    ["Bank details", /^\s*BANK\s+DETAILS\s*:?\s*(.*?)\s*$/im],
    ["Branch", /^\s*BRANCH\s*:?\s*(.*?)\s*$/im],
    ["IFSC code", /^\s*IFSC\s+CODE\s*:?\s*(.*?)\s*$/im],
  ] },
];

function valueFor(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  const value = match?.[1]?.replace(/\s+/g, " ").trim().replace(/^[.:—-]+|[.:—-]+$/g, "") ?? "";
  if (/^INSTALLATION\s+DATE/i.test(value)) return "";
  return value;
}

function extractWindows(text: string) {
  const lines = text.split(/\r?\n/);
  const starts = lines.map((line, index) => /^\s*W\d{1,4}\s+/i.test(line) ? index : -1).filter((index) => index >= 0);
  return starts.map((start, index) => {
    const nextRow = starts[index + 1] ?? lines.length;
    const endMarker = lines.findIndex((line, lineIndex) => lineIndex > start && lineIndex < nextRow && /^\s*(?:TOTAL\b|ACCOUNTS\s+CONTACT|PRODUCTION\s+CONTACT|NOTE\s+\d|PAYMENT\s+DETAILS)/i.test(line));
    const stop = endMarker >= 0 ? endMarker : nextRow;
    const segment = lines.slice(start, stop).join(" ").replace(/\s+/g, " ").trim();
    const previousLine = [...lines.slice(0, start)].reverse().find((line) => line.trim()) ?? "";
    const nearby = lines.slice(Math.max(0, start - 3), stop).join(" ").replace(/\s+/g, " ").trim();
    const primaryLine = lines[start].replace(/\s+/g, " ").trim();
    const match = primaryLine.match(/^\s*(W\d{1,4})\s+([A-Z0-9 /-]+?)\s+(\d{2,5})\s+(\d{2,5})\s+([\d,.]+)\s+(\d+)\s+(.+?)\s*$/i);
    const upper = nearby.toUpperCase();
    const trackType = previousLine.match(/\b\d+\s*TRACK\b.*$/i)?.[0]?.replace(/\s+(?:TOUCH|UPVC)\b.*$/i, "").trim();
    const louversType = match?.[7]?.replace(/\s+NA$/i, "").replace(/\s+(?:4|5|6)\s*MM\b.*$/i, "").trim();
    return {
      windowNo: match?.[1] ?? "",
      location: match?.[2]?.trim() ?? "",
      width: match?.[3] ?? "",
      height: match?.[4] ?? "",
      area: match?.[5] ?? "",
      quantity: match?.[6] ?? "",
      windowType: trackType ? `${trackType}${/\bMESH\b/i.test(nearby) ? " MESH" : ""}` : louversType || "",
      glass: /\b4\s*MM\s+FROSTED\b/.test(upper) ? "4 MM Frosted glass" : upper.match(/\b\d+\s*MM\s+(?:FROSTED|CLEAR|TOUGHENED)?\s*GLASS\b/)?.[0] ?? "",
      lockType: upper.includes("TOUCH") && upper.includes("LOCK") ? "Touch lock" : upper.includes("LOCK") ? "Lock" : /\bNA\b/.test(upper) ? "N/A" : "",
      profile: upper.includes("UPVC") ? "UPVC" : "",
      mesh: upper.includes("FIBER") ? "Fiber" : /AL+UMIN/.test(upper) ? "Aluminium" : "",
    };
  }).filter((row) => row.windowNo);
}

function buildInfo(text: string, method: ConfirmationInfo["method"], table?: NormalizedWindowImport): ConfirmationInfo {
  const sections = fieldGroups.map((group) => ({
    title: group.title,
    fields: group.fields.map(([label, pattern]) => ({ label, value: valueFor(text, pattern) })).filter((field) => field.value),
  })).filter((group) => group.fields.length);
  const termSection = text.split(/TERMS\s*(?:&|AND)\s*CONDITIONS\s*:?\s*/i)[1]?.split(/PAYMENT\s+TERMS/i)[0] ?? "";
  const terms = termSection.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d{1,2}\s+\S/.test(line)).map((line) => line.replace(/^\d{1,2}\s+/, "").trim());
  const windows = table ? table.rows.map((row) => ({
    windowNo: row.windowNo, location: row.location, width: row.widthMm == null ? "" : String(row.widthMm),
    height: row.heightMm == null ? "" : String(row.heightMm), area: row.areaSqFt == null ? "" : String(row.areaSqFt),
    quantity: String(row.quantity), windowType: row.windowType, glass: row.glass,
    lockType: row.lockType === "TOUCH LOCK" ? "Touch lock" : row.lockType,
    profile: row.profile === "UPVC WHITE" ? "UPVC" : row.profile,
    mesh: /ALLUMINIUM/i.test(row.mesh) ? "Aluminium" : row.mesh === "SS MESH" ? "" : row.mesh,
    originalCells: row.originalCells, page: row.page, rowPosition: row.originalCells[0]?.rowPosition,
    warnings: row.warnings, confidence: row.confidence,
  })) : extractWindows(text);
  const paymentTerms = [...text.matchAll(/(ADVANCE PAYMENT|BEFORE DISPATCH|ON INSTALLATION)\s+(?:₹\s*)?([\d,]+(?:\.\d+)?)/gi)]
    .map((match) => ({ label: match[1].replace(/\b\w/g, (letter) => letter.toUpperCase()), value: match[2] }));
  if (paymentTerms.length) sections.push({ title: "Payment terms", fields: paymentTerms });
  const hasContent = sections.length > 0 || windows.length > 0 || text.trim().length > 40;
  return {
    status: hasContent ? "extracted" : "no_text",
    method,
    extractedAt: new Date().toISOString(),
    sections,
    windows,
    ...(table ? {
      columns: table.columns,
      checksum: {
        rowsFound: table.rows.length,
        quantity: table.totals.quantity,
        calculatedAreaSqFt: table.totals.areaSqFt,
        documentAreaSqFt: table.totals.sourceAreaSqFt,
        matches: table.totals.sourceQuantity == null && table.totals.sourceAreaSqFt == null
          ? null
          : (table.totals.sourceQuantity == null || table.totals.sourceQuantity === table.totals.quantity)
            && (table.totals.sourceAreaSqFt == null || Math.abs(table.totals.areaSqFt - table.totals.sourceAreaSqFt) <= 0.005),
      },
    } : {}),
    terms,
    rawText: text.slice(0, 100_000).trim(),
    error: null,
  };
}

export async function extractConfirmationInfo(bytes: Buffer, filename: string): Promise<ConfirmationInfo> {
  const ext = path.extname(filename).toLowerCase();
  const isPdf = ext === ".pdf";
  const isImage = [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  const now = new Date().toISOString();
  if ([".xlsx", ".xlsm", ".xls", ".csv"].includes(ext)) {
    try {
      const sheets = parseWindowListWorkbook(bytes);
      const selected = sheets[0];
      const fields = Object.entries(selected.header)
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => ({ label: label.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()), value }));
      fields.push({ label: "Worksheet", value: selected.sheetName });
      fields.push({ label: "Window quantity", value: String(selected.totals.quantity) });
      fields.push({ label: "Total area (sq ft)", value: selected.totals.areaSqFt.toFixed(2) });
      return {
        status: "extracted", method: "none", extractedAt: now,
        sections: [{ title: "Workbook confirmation details", fields }],
        windows: selected.rows.map((row) => ({
          windowNo: row.windowNo, location: row.location, width: row.widthMm == null ? "" : String(row.widthMm),
          height: row.heightMm == null ? "" : String(row.heightMm), area: row.areaSqFt == null ? "" : String(row.areaSqFt),
          quantity: String(row.quantity), windowType: row.windowType, glass: row.glass, lockType: row.lockType,
          profile: row.profile, mesh: row.mesh, originalCells: row.originalCells,
          page: null, rowPosition: row.sourceRow, warnings: row.warnings, confidence: row.confidence,
        })),
        columns: selected.columns,
        checksum: { rowsFound: selected.rows.length, quantity: selected.totals.quantity, calculatedAreaSqFt: selected.totals.areaSqFt, documentAreaSqFt: selected.totals.sourceAreaSqFt, matches: selected.warnings.length ? false : true },
        terms: [], rawText: "", error: null,
      };
    } catch (error) {
      return { status: "failed", method: "none", extractedAt: now, sections: [], windows: [], terms: [], rawText: "", error: error instanceof Error ? error.message.slice(0, 500) : "Workbook extraction failed." };
    }
  }
  if (!isPdf && !isImage) return { status: "unsupported", method: "none", extractedAt: now, sections: [], windows: [], terms: [], rawText: "", error: "Automatic extraction currently supports PDF and image confirmation files." };
  const tempDir = await mkdtemp(path.join(tmpdir(), "confirmation-ocr-"));
  try {
    const input = path.join(tempDir, `source${ext}`);
    await writeFile(input, bytes);
    let text = "";
    let method: ConfirmationInfo["method"] = "pdf_text";
    if (isPdf) {
      try {
        const result = await execFile("pdftotext", ["-layout", input, "-"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
        text = result.stdout;
      } catch {
        text = "";
      }
    }
    if (!isPdf || text.trim().length < 40) {
      method = "ocr";
      if (isPdf) {
        const prefix = path.join(tempDir, "page");
        await execFile("pdftoppm", ["-f", "1", "-l", "8", "-r", "180", "-png", input, prefix], { timeout: 60_000, maxBuffer: 1024 * 1024 });
        const pages = (await readdir(tempDir)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const pageTexts = await Promise.all(pages.map(async (page) => (await execFile("tesseract", [path.join(tempDir, page), "stdout", "-l", "eng"], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })).stdout));
        text = pageTexts.join("\n");
      } else {
        text = (await execFile("tesseract", [input, "stdout", "-l", "eng"], { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
      }
    }
    if (isPdf) {
      try {
        const table = await parseWindowListPdf(bytes, filename);
        return buildInfo(text, method, table);
      } catch (error) {
        const info = buildInfo(text, method, {
          columns: [], header: {}, rows: [],
          totals: { areaSqFt: 0, quantity: 0, sourceAreaSqFt: null, sourceQuantity: null },
          paymentSummary: {}, warnings: [], source: "pdf", confidence: 0, sheetName: filename,
        });
        info.status = "failed";
        info.windows = [];
        info.error = error instanceof Error ? error.message.slice(0, 500) : "The PDF window table could not be read.";
        return info;
      }
    }
    return buildInfo(text, method);
  } catch (error) {
    return { status: "failed", method: "none", extractedAt: now, sections: [], windows: [], terms: [], rawText: "", error: error instanceof Error ? error.message.slice(0, 500) : "Document extraction failed." };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

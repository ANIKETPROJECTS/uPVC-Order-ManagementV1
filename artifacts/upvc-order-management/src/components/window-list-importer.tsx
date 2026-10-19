import { useState } from "react";
import { useCreateOrderWindow, useUploadOrderDocument } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ImportedRow = {
  sourceRow: number; windowNo: string; location: string; widthMm: number | null;
  heightMm: number | null; areaSqFt: number | null; quantity: number;
  windowType: string; glass: string; lockType: string; profile: string; mesh: string;
  finalMeasurementSqFt: number | null; warnings: string[];
};
type ImportSheet = {
  sheetName: string; header: Record<string, string>; rows: ImportedRow[];
  totals: { areaSqFt: number; quantity: number; sourceAreaSqFt: number | null; sourceQuantity: number | null };
  warnings: string[]; source: "excel"; confidence: number;
};

export function WindowListImporter({ orderId, meshType, user, onComplete }: {
  orderId: string; meshType: string; user: User; onComplete: () => void;
}) {
  const createWindow = useCreateOrderWindow();
  const uploadDocument = useUploadOrderDocument();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const preview = async (selectedFile: File, sheet?: string) => {
    setLoading(true); setError("");
    try {
      const suffix = sheet ? `?sheet=${encodeURIComponent(sheet)}` : "";
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/windows/import-preview/${encodeURIComponent(selectedFile.name)}${suffix}`, {
        method: "POST", headers: { "Content-Type": selectedFile.type || "application/octet-stream" }, body: selectedFile,
      });
      const result = await response.json() as { error?: string; sheets?: ImportSheet[] };
      if (!response.ok) throw new Error(result.error || "The workbook could not be previewed.");
      const returnedSheets = result.sheets ?? [];
      if (sheet) {
        const parsedSheet = returnedSheets.find((item) => item.sheetName === sheet);
        if (parsedSheet) setSheets((current) => current.map((item) => item.sheetName === sheet ? parsedSheet : item));
      } else {
        setSheets(returnedSheets);
      }
      if (!sheet && result.sheets?.length) {
        setSelectedSheet(result.sheets[0].sheetName);
        setRows(result.sheets[0].rows);
      } else {
        const active = result.sheets?.find((item) => item.sheetName === sheet);
        setRows(active?.rows ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be previewed.");
      setSheets([]); setRows([]);
    } finally { setLoading(false); }
  };
  const chooseFile = (selected: File | null) => {
    setFile(selected); setSheets([]); setRows([]); setSelectedSheet(""); setError("");
    if (selected) void preview(selected);
  };
  const editCell = (index: number, field: keyof ImportedRow, value: string) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, [field]: field === "widthMm" || field === "heightMm" || field === "quantity" ? Number(value) || null : value }
      : row));
  };
  const confirmImport = async () => {
    if (!file || !rows.length) return;
    const duplicateNumbers = new Set<string>();
    const invalid = rows.some((row) => {
      const key = row.windowNo.trim().toLocaleLowerCase();
      if (key && duplicateNumbers.has(key)) return true;
      if (key) duplicateNumbers.add(key);
      return !key || !row.windowType.trim() || !row.widthMm || !row.heightMm || !row.quantity || row.widthMm <= 0 || row.heightMm <= 0;
    });
    if (invalid) { setError("Fix every highlighted row: window number, window type, dimensions, and quantity are required; window numbers must be unique."); return; }
    setSaving(true); setError("");
    let created = 0;
    try {
      for (const row of rows) {
        await createWindow.mutateAsync({ id: orderId, data: {
          windowNo: row.windowNo.trim(), widthMm: row.widthMm!, heightMm: row.heightMm!,
          windowType: row.windowType.trim(), location: row.location || null,
          glassType: row.glass || null, meshType: meshType || null,
          frameCount: row.quantity, lotId: null, frameStatus: "pending",
          shutterStatus: "pending", glassStatus: "pending", pendingReason: null,
        } });
        created += 1;
      }
      await uploadDocument.mutateAsync({ id: orderId, category: "confirmation", filename: encodeURIComponent(file.name), data: file });
      onComplete();
      toast({ title: "Window list imported", description: `${created} windows were added and the source workbook was saved to Order Documents.` });
      setFile(null); setRows([]); setSheets([]); setSelectedSheet("");
    } catch (cause) {
      onComplete();
      setError(created
        ? `${created} of ${rows.length} windows were added before the error. Resolve the issue, then import only the remaining rows.`
        : cause instanceof Error ? cause.message : "The window list could not be imported.");
    } finally { setSaving(false); }
  };
  const activeSheet = sheets.find((item) => item.sheetName === selectedSheet);
  return <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm" data-testid="window-list-importer">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">Import window list</h3><p className="mt-1 text-xs text-muted-foreground">Excel is recommended. Review the rows before adding them. Maximum 10 MiB.</p></div>
      <a href={`/api/orders/${encodeURIComponent(orderId)}/windows/import-template`} className="text-xs font-semibold text-primary underline">Download Excel template</a>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
        Upload Excel
        <input className="sr-only" type="file" accept=".xlsx,.xlsm,.xls,.csv" disabled={loading || saving} onChange={(event) => { chooseFile(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
      </label>
      {file && <span className="max-w-64 truncate text-xs text-muted-foreground">{file.name}</span>}
      {loading && <span className="text-xs text-muted-foreground">Reading workbook…</span>}
    </div>
    {sheets.length > 1 && <label className="mt-3 block max-w-sm text-xs font-semibold">Worksheet<select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={selectedSheet} onChange={(event) => { setSelectedSheet(event.target.value); if (file) void preview(file, event.target.value); }}><option value="">Choose sheet</option>{sheets.map((sheet) => <option key={sheet.sheetName}>{sheet.sheetName}</option>)}</select></label>}
    {activeSheet && <><div className="mt-3 flex flex-wrap gap-3 text-xs"><span><strong>{rows.length}</strong> rows</span><span><strong>{activeSheet.totals.quantity}</strong> windows</span><span><strong>{activeSheet.totals.areaSqFt.toFixed(2)}</strong> sq ft</span></div>
      {activeSheet.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-800">{warning}</p>)}
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr>{["Window no.", "Location", "Width mm", "Height mm", "Qty", "Window type", "Glass", "Source row / warnings"].map((title) => <th key={title} className="border-b border-border px-2 py-2">{title}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.sourceRow}-${index}`} className={row.warnings.length ? "bg-amber-50/70" : "even:bg-muted/20"}><td className="p-1"><input aria-label={`Window number row ${row.sourceRow}`} className="w-24 rounded border border-input bg-background px-1.5 py-1" value={row.windowNo} onChange={(e) => editCell(index, "windowNo", e.target.value)} /></td><td className="p-1"><input aria-label={`Location row ${row.sourceRow}`} className="w-28 rounded border border-input bg-background px-1.5 py-1" value={row.location} onChange={(e) => editCell(index, "location", e.target.value)} /></td><td className="p-1"><input type="number" aria-label={`Width row ${row.sourceRow}`} className="w-20 rounded border border-input bg-background px-1.5 py-1" value={row.widthMm ?? ""} onChange={(e) => editCell(index, "widthMm", e.target.value)} /></td><td className="p-1"><input type="number" aria-label={`Height row ${row.sourceRow}`} className="w-20 rounded border border-input bg-background px-1.5 py-1" value={row.heightMm ?? ""} onChange={(e) => editCell(index, "heightMm", e.target.value)} /></td><td className="p-1"><input type="number" min="1" aria-label={`Quantity row ${row.sourceRow}`} className="w-16 rounded border border-input bg-background px-1.5 py-1" value={row.quantity} onChange={(e) => editCell(index, "quantity", e.target.value)} /></td><td className="p-1"><input aria-label={`Window type row ${row.sourceRow}`} className="w-32 rounded border border-input bg-background px-1.5 py-1" value={row.windowType} onChange={(e) => editCell(index, "windowType", e.target.value)} /></td><td className="p-1"><input aria-label={`Glass row ${row.sourceRow}`} className="w-28 rounded border border-input bg-background px-1.5 py-1" value={row.glass} onChange={(e) => editCell(index, "glass", e.target.value)} /></td><td className="p-2"><span>{row.sourceRow}</span>{row.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-800">{warning}</p>)}</td></tr>)}</tbody></table></div>
      <div className="mt-3 flex justify-end"><Button size="sm" disabled={saving || loading || !rows.length} onClick={() => void confirmImport()}>{saving ? "Importing…" : `Confirm import ${rows.length} rows`}</Button></div></>}
    {error && <p className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
  </section>;
}

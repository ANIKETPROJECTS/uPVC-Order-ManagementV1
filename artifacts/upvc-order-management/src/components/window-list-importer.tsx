import { useState } from "react";
import { useArchiveOrderDocument, useUploadOrderDocument } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ImportedRow = {
  sourceRow: number; windowNo: string; location: string; widthMm: number | null;
  heightMm: number | null; areaSqFt: number | null; quantity: number;
  windowType: string; glass: string; lockType: string; profile: string; mesh: string;
  finalMeasurementSqFt: number | null; warnings: string[];
  originalCells?: Array<{ columnLabel: string; text: string; page: number | null; rowPosition: number }>;
  page?: number | null; confidence?: number;
};
type ImportSheet = {
  sheetName: string; columns?: string[]; header: Record<string, string>; rows: ImportedRow[];
  totals: { areaSqFt: number; quantity: number; sourceAreaSqFt: number | null; sourceQuantity: number | null };
  paymentSummary: Record<string, string>;
  warnings: string[]; source: "excel" | "pdf"; confidence: number;
};

export function WindowListImporter({ orderId, meshType, user, onComplete }: {
  orderId: string; meshType: string; user: User; onComplete: () => void;
}) {
  const uploadDocument = useUploadOrderDocument();
  const archiveDocument = useArchiveOrderDocument();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [displayMode, setDisplayMode] = useState<"document" | "software">("document");
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
      ? { ...row, [field]: field === "widthMm" || field === "heightMm" || field === "quantity" ? (value === "" ? null : Number(value)) : value }
      : row));
  };
  const addRow = () => setRows((current) => [...current, {
    sourceRow: current.length ? Math.max(...current.map((row) => row.sourceRow)) + 1 : 1,
    windowNo: "", location: "", widthMm: null, heightMm: null, areaSqFt: null, quantity: 1,
    windowType: "", glass: "", lockType: "", profile: "", mesh: "", finalMeasurementSqFt: null, warnings: [],
  }]);
  const deleteRow = (index: number) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  const totalAreaSqFt = rows.reduce((sum, row) => sum + ((Number(row.widthMm) > 0 && Number(row.heightMm) > 0)
    ? Number(row.widthMm) * Number(row.heightMm) * Math.max(0, Number(row.quantity) || 0) / 92903.04 : 0), 0);
  const totalQuantity = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
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
    let sourceDocumentId: string | null = null;
    try {
      const savedDocument = await uploadDocument.mutateAsync({ id: orderId, category: "confirmation", filename: encodeURIComponent(file.name), data: file });
      sourceDocumentId = savedDocument.id;
      const payloadRows = rows.map((row) => ({
        windowNo: row.windowNo.trim(), widthMm: Number(row.widthMm), heightMm: Number(row.heightMm),
        windowType: row.windowType.trim(), location: row.location || null, glassType: row.glass || null,
        meshType: meshType || null, frameCount: Number(row.quantity), lotId: null,
        frameStatus: "pending", shutterStatus: "pending", glassStatus: "pending", pendingReason: null,
        lockType: row.lockType, profile: row.profile, mesh: row.mesh,
      }));
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/windows/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, source: activeSheet?.source ?? "excel", rows: payloadRows }),
      });
      const result = await response.json() as { created?: number; error?: string };
      if (!response.ok) throw new Error(result.error || "The window rows could not be saved.");
      onComplete();
      toast({ title: "Window list imported", description: `${result.created ?? rows.length} window rows were saved. Source: ${file.name}.` });
      setFile(null); setRows([]); setSheets([]); setSelectedSheet("");
    } catch (cause) {
      if (sourceDocumentId) await archiveDocument.mutateAsync({ id: orderId, documentId: sourceDocumentId }).catch(() => undefined);
      onComplete();
      setError(cause instanceof Error ? cause.message : "The window list could not be imported. No windows were saved.");
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
      <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-muted">
        Upload PDF
        <input className="sr-only" type="file" accept=".pdf,application/pdf" disabled={loading || saving} onChange={(event) => { chooseFile(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
      </label>
      {file && <span className="max-w-64 truncate text-xs text-muted-foreground">{file.name}</span>}
      {loading && <span className="text-xs text-muted-foreground">Reading workbook…</span>}
    </div>
    {sheets.length > 1 && <label className="mt-3 block max-w-sm text-xs font-semibold">Worksheet<select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={selectedSheet} onChange={(event) => { setSelectedSheet(event.target.value); if (file) void preview(file, event.target.value); }}><option value="">Choose sheet</option>{sheets.map((sheet) => <option key={sheet.sheetName}>{sheet.sheetName}</option>)}</select></label>}
    {activeSheet && <><div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span><strong>{rows.length}</strong> rows</span><span><strong>{totalQuantity}</strong> windows</span><span><strong>{totalAreaSqFt.toFixed(2)}</strong> sq ft</span><span>Source: <strong>{activeSheet.source.toUpperCase()}</strong></span><span className="max-w-64 truncate">{file?.name}</span><div className="ml-auto flex gap-1"><Button size="sm" variant={displayMode === "document" ? "default" : "outline"} onClick={() => setDisplayMode("document")}>Document view</Button><Button size="sm" variant={displayMode === "software" ? "default" : "outline"} onClick={() => setDisplayMode("software")}>Software view</Button></div></div>
      {activeSheet.source === "pdf" && <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">PDF import, please verify.</p>}
      {activeSheet.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-800">{warning}</p>)}
      {Object.keys(activeSheet.paymentSummary).length > 0 && <section className="mt-3 rounded-lg border border-border bg-muted/20 p-3"><h4 className="text-xs font-bold">Payment block (source values; read-only)</h4><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(activeSheet.paymentSummary).map(([label,value]) => <div key={label} className="rounded border border-border bg-card p-2 text-xs"><span className="block text-muted-foreground">{label}</span><strong>{value}</strong></div>)}</div></section>}
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="sticky top-0 bg-muted"><tr>{(displayMode === "document" ? [...(activeSheet.columns ?? []), ...(activeSheet.source === "pdf" ? ["Page"] : []), "Check"] : ["Window no.", "Location", "Width mm", "Height mm", "Qty", "Window type", "Glass", "Lock type", "Profile", "Mesh", "Sq ft", "Source row / warnings", ""]).map((title, index) => <th key={`${title}-${index}`} className="border-b border-border px-2 py-2">{title}</th>)}</tr></thead>
          <tbody>
            {displayMode === "document"
              ? rows.map((row, index) => <tr key={`${row.sourceRow}-${index}`} className={row.warnings.length ? "bg-amber-50/70" : "even:bg-muted/20"}>
                  {(activeSheet.columns ?? []).map((label, cellIndex) => <td key={`${label}-${cellIndex}`} className="px-2 py-1">{row.originalCells?.[cellIndex]?.text ?? ""}</td>)}
                  {activeSheet.source === "pdf" && <td className="px-2 py-1">{row.page ? `Page ${row.page}` : ""}</td>}
                  <td className="px-2 py-1 text-amber-800">{row.warnings.join(" ")}</td>
                </tr>)
              : rows.map((row, index) => <tr key={`${row.sourceRow}-${index}`} className={row.warnings.length ? "bg-amber-50/70" : "even:bg-muted/20"}>
                  {(["windowNo","location","widthMm","heightMm","quantity","windowType","glass","lockType","profile","mesh"] as const).map((field) => <td key={field} className="p-1"><input type={field === "widthMm" || field === "heightMm" || field === "quantity" ? "number" : "text"} min={field === "quantity" ? 1 : undefined} aria-label={`${field} row ${row.sourceRow}`} className="w-28 rounded border border-input bg-background px-1.5 py-1" value={row[field] ?? ""} onChange={(e) => editCell(index, field, e.target.value)} /></td>)}
                  <td className="px-2 py-1">{row.widthMm && row.heightMm ? (row.widthMm * row.heightMm * row.quantity / 92903.04).toFixed(2) : ""}</td>
                  <td className="p-2"><span>{row.sourceRow}</span>{row.warnings.map((warning) => <p key={warning} className="mt-1 text-[10px] text-amber-800">{warning}</p>)}</td>
                  <td className="p-1"><Button size="sm" variant="ghost" onClick={() => deleteRow(index)} aria-label={`Delete row ${row.sourceRow}`}>Delete</Button></td>
                </tr>)}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-between"><Button size="sm" variant="outline" onClick={addRow}>Add row</Button><Button size="sm" disabled={saving || loading || !rows.length} onClick={() => void confirmImport()}>{saving ? "Importing…" : `Confirm import ${rows.length} rows`}</Button></div></>}
    {error && <p className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
  </section>;
}

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, FileText, Loader2, X } from 'lucide-react';
import type { OrderDocument } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

type SpreadsheetPreview = {
  name: string;
  rows: string[][];
  truncated: boolean;
};

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'docx'; text: string }
  | { kind: 'xlsx'; sheets: SpreadsheetPreview[] }
  | { kind: 'unsupported' }
  | { kind: 'error' };

const PREVIEW_ROW_LIMIT = 200;
const PREVIEW_COLUMN_LIMIT = 16;

function cellText(value: unknown): string {
  if (value instanceof Date) return value.toLocaleString();
  return value == null ? '' : String(value);
}

export function DocumentPreviewDialog({
  documentRecord,
  file,
  loading,
  onClose,
}: {
  documentRecord: OrderDocument;
  file: Blob | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });
  const [activeSheet, setActiveSheet] = useState(0);
  const extension = documentRecord.filename.toLowerCase().split('.').pop() || '';

  useEffect(() => {
    let active = true;
    let temporaryUrl: string | undefined;
    setPreview({ kind: loading ? 'loading' : 'unsupported' });
    setActiveSheet(0);

    if (!file || loading) {
      return () => { active = false; };
    }

    const loadPreview = async () => {
      try {
        if (documentRecord.contentType.startsWith('image/')) {
          temporaryUrl = URL.createObjectURL(file);
          if (active) setPreview({ kind: 'image', url: temporaryUrl });
          return;
        }
        if (documentRecord.contentType === 'application/pdf' || extension === 'pdf') {
          temporaryUrl = URL.createObjectURL(file);
          if (active) setPreview({ kind: 'pdf', url: temporaryUrl });
          return;
        }
        if (extension === 'docx') {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          if (active) setPreview({ kind: 'docx', text: result.value });
          return;
        }
        if (extension === 'xlsx') {
          const { default: readXlsxFile } = await import('read-excel-file/browser');
          const worksheets = await readXlsxFile(file);
          const sheets = worksheets.map((worksheet) => {
            const truncated = worksheet.data.length > PREVIEW_ROW_LIMIT
              || worksheet.data.some((row) => row.length > PREVIEW_COLUMN_LIMIT);
            const rows = worksheet.data.slice(0, PREVIEW_ROW_LIMIT).map((row) =>
              row.slice(0, PREVIEW_COLUMN_LIMIT).map(cellText),
            );
            return { name: worksheet.sheet, rows, truncated };
          });
          if (active) setPreview({ kind: 'xlsx', sheets });
          return;
        }
        if (active) setPreview({ kind: 'unsupported' });
      } catch {
        if (active) setPreview({ kind: 'error' });
      }
    };

    void loadPreview();
    return () => {
      active = false;
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    };
  }, [documentRecord.contentType, extension, file, loading]);

  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = documentRecord.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sheet = preview.kind === 'xlsx' ? preview.sheets[activeSheet] : undefined;
  let previewContent: ReactNode;
  if (loading || preview.kind === 'loading') {
    previewContent = <div className="grid min-h-[280px] place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading preview…</span></div>;
  } else {
    switch (preview.kind) {
      case 'error':
        previewContent = <div className="grid min-h-[280px] place-items-center text-center"><div><p className="text-sm font-semibold">Preview unavailable</p><p className="mt-1 text-xs text-muted-foreground">The file could not be read. Download it to open it in another app.</p></div></div>;
        break;
      case 'unsupported':
        previewContent = <div className="grid min-h-[280px] place-items-center text-center"><div><p className="text-sm font-semibold">No preview for this file type</p><p className="mt-1 text-xs text-muted-foreground">Download the file to open it in a compatible app.</p></div></div>;
        break;
      case 'image':
        previewContent = <div className="grid min-h-[280px] place-items-center"><img src={preview.url} alt={documentRecord.filename} className="max-h-[70vh] max-w-full object-contain" data-testid="preview-document-image" /></div>;
        break;
      case 'pdf':
        previewContent = <iframe src={preview.url} title={`Preview of ${documentRecord.filename}`} className="h-[70vh] min-h-[360px] w-full rounded-lg border border-border bg-background" data-testid="preview-document-pdf" />;
        break;
      case 'docx':
        previewContent = <div className="mx-auto max-w-3xl rounded-lg border border-border bg-background p-5 sm:p-8" data-testid="preview-document-docx"><p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Text preview · formatting may differ</p><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground">{preview.text || 'No readable text was found in this document.'}</pre></div>;
        break;
      case 'xlsx':
        previewContent = preview.sheets.length === 0
          ? <div className="grid min-h-[280px] place-items-center text-sm text-muted-foreground" data-testid="preview-document-xlsx-empty">This workbook has no visible sheets.</div>
          : <div data-testid="preview-document-xlsx">
            <div className="mb-3 flex flex-wrap gap-2">{preview.sheets.map((item, index) => <Button key={item.name} type="button" size="sm" variant={index === activeSheet ? 'secondary' : 'outline'} onClick={() => setActiveSheet(index)} data-testid={`button-preview-sheet-${index}`}>{item.name}</Button>)}</div>
            {sheet && <div className="overflow-auto rounded-lg border border-border bg-background"><table className="w-full border-collapse text-left text-xs"><tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/70 last:border-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-[320px] whitespace-pre-wrap break-words px-3 py-2 align-top">{cell || <span className="text-muted-foreground/40">—</span>}</td>)}</tr>)}</tbody></table></div>}
            {sheet?.truncated && <p className="mt-2 text-[11px] text-muted-foreground">Preview limited to the first {PREVIEW_ROW_LIMIT} rows and {PREVIEW_COLUMN_LIMIT} columns on this sheet.</p>}
          </div>;
        break;
    }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-3 sm:items-center" data-testid="dialog-document-preview">
    <section className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="document-preview-title">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground"><FileText size={17} /></span>
          <div className="min-w-0"><h2 id="document-preview-title" className="break-words text-sm font-semibold">{documentRecord.filename}</h2><p className="mt-1 text-[11px] text-muted-foreground">{documentRecord.contentType} · {documentRecord.sizeBytes.toLocaleString()} bytes</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={!file} data-testid="button-download-preview-document"><Download size={13} /> Download</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Close preview" onClick={onClose} data-testid="button-close-document-preview"><X size={16} /></Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4 sm:p-6" data-testid="document-preview-content">
        {previewContent}
      </div>
    </section>
  </div>;
}
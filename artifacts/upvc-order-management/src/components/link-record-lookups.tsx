import { useState } from 'react';
import {
  getSearchMeasurementRecordsQueryKey,
  getSearchQuotationRateSubmissionsQueryKey,
  useSearchMeasurementRecords,
  useSearchQuotationRateSubmissions,
} from '@workspace/api-client-react';
import type {
  MeasurementRecordLookup,
  QuotationRateSubmissionLookup,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';

export const measurementSheetIdLabel = (id: string) => `MS-${id.toUpperCase()}`;

export function QuotationRequestLookup({
  selectedId,
  selectedLabel,
  currentMeasurementRecordId,
  onSelect,
}: {
  selectedId: string | null;
  selectedLabel: string;
  currentMeasurementRecordId: string;
  onSelect: (item: QuotationRateSubmissionLookup) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useSearchQuotationRateSubmissions(
    { query },
    { query: { queryKey: getSearchQuotationRateSubmissionsQueryKey({ query }), enabled: query.trim().length >= 2, refetchOnWindowFocus: false } },
  );

  return (
    <div className="space-y-2" data-testid="lookup-quotation-request">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search temporary ID, e.g. RA-1000"
        aria-label="Search quotation request ID"
        data-testid="input-search-quotation-request"
      />
      {selectedId && <p className="text-[11px] font-semibold text-primary">Selected: {selectedLabel}</p>}
      {query.trim().length >= 2 && (
        <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border bg-card p-1.5" role="listbox" aria-label="Quotation requests">
          {results.isLoading ? <p className="p-2 text-xs text-muted-foreground">Searching requests…</p>
            : results.isError ? <p className="p-2 text-xs text-destructive">Could not search requests. Try again.</p>
              : (results.data || []).length === 0 ? <p className="p-2 text-xs text-muted-foreground">No matching quotation request.</p>
                : (results.data || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selectedId === item.id}
                    disabled={Boolean(item.measurementRecordId && item.measurementRecordId !== currentMeasurementRecordId)}
                    onClick={() => onSelect(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`option-quotation-request-${item.id}`}
                  >
                    <span><strong>{item.id}</strong><span className="ml-2 text-muted-foreground">{item.clientName}</span></span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{item.measurementRecordId ? `Linked to ${measurementSheetIdLabel(item.measurementRecordId)}` : item.status.replaceAll('_', ' ')}</span>
                  </button>
                ))}
        </div>
      )}
    </div>
  );
}

export function MeasurementSheetLookup({
  selectedId,
  selectedLabel,
  currentQuotationRequestId,
  onSelect,
}: {
  selectedId: string | null;
  selectedLabel: string;
  currentQuotationRequestId: string;
  onSelect: (item: MeasurementRecordLookup) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useSearchMeasurementRecords(
    { query },
    { query: { queryKey: getSearchMeasurementRecordsQueryKey({ query }), enabled: query.trim().length >= 2, refetchOnWindowFocus: false } },
  );

  return (
    <div className="space-y-2" data-testid="lookup-measurement-sheet">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by client or measurement sheet"
        aria-label="Search measurement sheets"
        data-testid="input-search-measurement-sheet"
      />
      {selectedId && <p className="text-[11px] font-semibold text-primary">Selected: {selectedLabel}</p>}
      {query.trim().length >= 2 && (
        <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-border bg-card p-1.5" role="listbox" aria-label="Measurement sheets">
          {results.isLoading ? <p className="p-2 text-xs text-muted-foreground">Searching measurement sheets…</p>
            : results.isError ? <p className="p-2 text-xs text-destructive">Could not search sheets. Try again.</p>
              : (results.data || []).length === 0 ? <p className="p-2 text-xs text-muted-foreground">No matching measurement sheet.</p>
                : (results.data || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selectedId === item.id}
                    disabled={Boolean(item.quotationRequestId && item.quotationRequestId !== currentQuotationRequestId)}
                    onClick={() => onSelect(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`option-measurement-sheet-${item.id}`}
                  >
                    <span className="min-w-0"><strong>{measurementSheetIdLabel(item.id)}</strong><span className="ml-2">{item.clientName}</span>{item.location && <span className="ml-2 text-muted-foreground">{item.location}</span>}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{item.quotationRequestId ? `Linked to ${item.quotationRequestId}` : item.orderId || 'No order'}</span>
                  </button>
                ))}
        </div>
      )}
    </div>
  );
}
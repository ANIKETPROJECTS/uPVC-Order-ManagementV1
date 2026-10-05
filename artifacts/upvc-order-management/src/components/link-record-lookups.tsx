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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const measurementSheetIdLabel = (id: string, sheetId?: string | null) =>
  sheetId || `MS-${id.toUpperCase()}`;

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
    { query: { queryKey: getSearchQuotationRateSubmissionsQueryKey({ query }), enabled: true, refetchOnWindowFocus: false } },
  );
  const requests = results.data || [];
  const selectedRequestIsListed = Boolean(selectedId && requests.some((item) => item.id === selectedId));

  return (
    <div className="min-w-0 w-full space-y-2" data-testid="lookup-quotation-request">
      <Input
        className="min-w-0 w-full"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by RA ID or client name"
        aria-label="Search quotation requests by ID or client"
        data-testid="input-search-quotation-request"
      />
      <Select
        value={selectedId || undefined}
        onValueChange={(value) => {
          const selected = requests.find((item) => item.id === value);
          if (selected) onSelect(selected);
        }}
      >
        <SelectTrigger className="min-w-0 overflow-hidden" aria-label="Select a Rate Approval request" data-testid="select-quotation-request">
          <SelectValue className="min-w-0 flex-1 truncate" placeholder={results.isLoading ? 'Loading current requests…' : 'Choose from current Rate Approval requests'}>
            {selectedId ? selectedLabel || selectedId : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {results.isLoading && <SelectItem value="__loading" disabled>Loading current requests…</SelectItem>}
          {results.isError && <SelectItem value="__error" disabled>Could not load requests. Try again.</SelectItem>}
          {!results.isLoading && !results.isError && requests.length === 0 && <SelectItem value="__empty" disabled>No matching quotation request.</SelectItem>}
          {selectedId && !selectedRequestIsListed && <SelectItem value={selectedId}>{selectedLabel || selectedId}</SelectItem>}
          {requests.map((item) => (
            <SelectItem
              key={item.id}
              value={item.id}
              disabled={Boolean(item.measurementRecordId && item.measurementRecordId !== currentMeasurementRecordId)}
              data-testid={`option-quotation-request-${item.id}`}
            >
              <span className="flex max-w-[28rem] items-center justify-between gap-4">
                <span className="truncate"><strong>{item.id}</strong><span className="ml-2">{item.clientName}</span></span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{item.measurementRecordId ? `Linked to ${measurementSheetIdLabel(item.measurementRecordId, item.measurementSheetId)}` : item.status.replaceAll('_', ' ')}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
    { query: { queryKey: getSearchMeasurementRecordsQueryKey({ query }), enabled: true, refetchOnWindowFocus: false } },
  );
  const sheets = results.data || [];
  const selectedSheetIsListed = Boolean(selectedId && sheets.some((item) => item.id === selectedId));

  return (
    <div className="min-w-0 w-full space-y-2" data-testid="lookup-measurement-sheet">
      <Input
        className="min-w-0 w-full"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by sheet ID, client, or location"
        aria-label="Search measurement sheets by ID, client, or location"
        data-testid="input-search-measurement-sheet"
      />
      <Select
        value={selectedId || undefined}
        onValueChange={(value) => {
          const selected = sheets.find((item) => item.id === value);
          if (selected) onSelect(selected);
        }}
      >
        <SelectTrigger className="min-w-0 overflow-hidden" aria-label="Select a measurement sheet" data-testid="select-measurement-sheet">
          <SelectValue className="min-w-0 flex-1 truncate" placeholder={results.isLoading ? 'Loading current sheets…' : 'Choose from current measurement sheets'}>
            {selectedId ? selectedLabel || measurementSheetIdLabel(selectedId) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {results.isLoading && <SelectItem value="__loading" disabled>Loading current sheets…</SelectItem>}
          {results.isError && <SelectItem value="__error" disabled>Could not load sheets. Try again.</SelectItem>}
          {!results.isLoading && !results.isError && sheets.length === 0 && <SelectItem value="__empty" disabled>No matching measurement sheet.</SelectItem>}
          {selectedId && !selectedSheetIsListed && <SelectItem value={selectedId}>{selectedLabel || measurementSheetIdLabel(selectedId)}</SelectItem>}
          {sheets.map((item) => (
            <SelectItem
              key={item.id}
              value={item.id}
              disabled={Boolean(item.quotationRequestId && item.quotationRequestId !== currentQuotationRequestId)}
              data-testid={`option-measurement-sheet-${item.id}`}
            >
              <span className="flex max-w-[28rem] items-center justify-between gap-4">
                <span className="truncate"><strong>{measurementSheetIdLabel(item.id, item.sheetId)}</strong><span className="ml-2">{item.clientName}</span>{item.location && <span className="ml-2 text-muted-foreground">{item.location}</span>}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{item.quotationRequestId ? `Linked to ${item.quotationRequestId}` : item.orderId || 'No order'}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
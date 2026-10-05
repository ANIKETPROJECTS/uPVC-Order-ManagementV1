import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import {
  getListMeasurementRecordsQueryKey,
  getListMeasurementReferencesQueryKey,
  useCreateMeasurementReference,
  useDeleteMeasurementReference,
  useListMeasurementReferences,
  useUpdateMeasurementReference,
  useUpdateMeasurementVersion,
} from '@workspace/api-client-react';
import type {
  MeasurementReferenceOption,
  MeasurementVersion,
  MeasurementVersionUpdate,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type MeasurementType = NonNullable<MeasurementVersion['measurementType']>;

const measurementTypeLabel = (value: MeasurementType | null | undefined) =>
  value === 'quotation' ? 'Quotation measurement' : value === 'final' ? 'Final measurement' : 'Not selected';

const referenceValue = (kind: MeasurementReferenceOption['kind'], id: string) => `${kind}:${id}`;

export function useMeasurementReferenceOptions(enabled: boolean) {
  return {
    ...useListMeasurementReferences({
      query: {
        queryKey: getListMeasurementReferencesQueryKey(),
        enabled,
        staleTime: 30_000,
      },
    }),
  };
}

export function MeasurementVersionMetadataFields({
  recordId,
  version,
  canEdit,
  references,
  referencesLoading,
  referencesError,
}: {
  recordId: string;
  version: MeasurementVersion;
  canEdit: boolean;
  references: MeasurementReferenceOption[];
  referencesLoading: boolean;
  referencesError: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateVersion = useUpdateMeasurementVersion();
  const selectedReferenceValue = version.referenceType && version.referenceId
    ? referenceValue(version.referenceType, version.referenceId)
    : 'none';
  const selectedReference = references.find(
    (reference) => referenceValue(reference.kind, reference.id) === selectedReferenceValue,
  );

  const save = (data: MeasurementVersionUpdate) => {
    updateVersion.mutate({ recordId, versionId: version.id, data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() });
      },
      onError: () => toast({
        title: 'Could not update measurement sheet',
        description: 'The saved file details were not changed. Refresh the page and try again.',
        variant: 'destructive',
      }),
    });
  };

  const changeReference = (value: string) => {
    if (value === 'none') {
      if (selectedReferenceValue !== 'none') save({ referenceType: null, referenceId: null });
      return;
    }
    const separator = value.indexOf(':');
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if ((kind !== 'user' && kind !== 'custom') || !id || value === selectedReferenceValue) return;
    save({ referenceType: kind, referenceId: id });
  };

  if (!canEdit) {
    return (
      <div className="grid gap-2 text-xs sm:grid-cols-2" data-testid={`measurement-version-metadata-${version.id}`}>
        <p><span className="block text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Measurement type</span><span className="font-medium">{measurementTypeLabel(version.measurementType)}</span></p>
        <p><span className="block text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Reference</span><span className="font-medium">{selectedReference?.name || version.referenceName || 'Not selected'}</span></p>
      </div>
    );
  }

  const isSaving = updateVersion.isPending;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={`measurement-version-metadata-${version.id}`}>
      <label className="min-w-0 space-y-1 text-[10px] font-semibold text-muted-foreground">
        <span>Measurement type</span>
        <Select
          value={version.measurementType ?? 'none'}
          onValueChange={(value) => {
            const next = value === 'none' ? null : value as MeasurementType;
            if ((version.measurementType ?? null) !== next) save({ measurementType: next });
          }}
          disabled={isSaving}
        >
          <SelectTrigger aria-label={`Measurement type for ${version.filename}`} data-testid={`select-measurement-type-${version.id}`}>
            <SelectValue placeholder="Choose measurement type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Choose type</SelectItem>
            <SelectItem value="quotation">Quotation measurement</SelectItem>
            <SelectItem value="final">Final measurement</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label className="min-w-0 space-y-1 text-[10px] font-semibold text-muted-foreground">
        <span>Reference</span>
        <Select value={selectedReferenceValue} onValueChange={changeReference} disabled={isSaving || referencesLoading}>
          <SelectTrigger aria-label={`Reference for ${version.filename}`} data-testid={`select-measurement-reference-${version.id}`}>
            <SelectValue placeholder={referencesLoading ? 'Loading references…' : 'Choose a reference'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No reference</SelectItem>
            {references.some((reference) => reference.kind === 'user') && (
              <SelectGroup>
                <SelectLabel>Existing users</SelectLabel>
                {references.filter((reference) => reference.kind === 'user').map((reference) => (
                  <SelectItem key={reference.id} value={referenceValue(reference.kind, reference.id)}>{reference.name}</SelectItem>
                ))}
              </SelectGroup>
            )}
            {references.some((reference) => reference.kind === 'custom') && (
              <SelectGroup>
                <SelectLabel>Custom references</SelectLabel>
                {references.filter((reference) => reference.kind === 'custom').map((reference) => (
                  <SelectItem key={reference.id} value={referenceValue(reference.kind, reference.id)}>{reference.name}</SelectItem>
                ))}
              </SelectGroup>
            )}
            {selectedReferenceValue !== 'none' && !selectedReference && (
              <SelectItem value={selectedReferenceValue} disabled>
                {version.referenceName || 'Unavailable reference'} (no longer available)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {referencesError && <span className="block font-normal text-destructive">Reference choices could not be loaded.</span>}
      </label>
    </div>
  );
}

export function MeasurementReferenceManager({
  canEdit,
  references,
  loading,
  error,
}: {
  canEdit: boolean;
  references: MeasurementReferenceOption[];
  loading: boolean;
  error: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createReference = useCreateMeasurementReference();
  const updateReference = useUpdateMeasurementReference();
  const deleteReference = useDeleteMeasurementReference();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const customReferences = references.filter((reference) => reference.kind === 'custom');

  if (!canEdit) return null;

  const invalidateReferences = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListMeasurementReferencesQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() }),
  ]);

  const addReference = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createReference.mutate({ data: { name } }, {
      onSuccess: async () => {
        await invalidateReferences();
        setNewName('');
        toast({ title: 'Custom reference added', description: `${name} can now be selected for measurement files.` });
      },
      onError: () => toast({
        title: 'Could not add custom reference',
        description: 'Choose a unique name and try again.',
        variant: 'destructive',
      }),
    });
  };

  const saveReference = (reference: MeasurementReferenceOption) => {
    const name = editingName.trim();
    if (!name) return;
    updateReference.mutate({ referenceId: reference.id, data: { name } }, {
      onSuccess: async () => {
        await invalidateReferences();
        setEditingId(null);
        setEditingName('');
        toast({ title: 'Custom reference updated', description: 'Files using this reference now show its new name.' });
      },
      onError: () => toast({
        title: 'Could not update custom reference',
        description: 'Choose a unique name and try again.',
        variant: 'destructive',
      }),
    });
  };

  const removeReference = (reference: MeasurementReferenceOption) => {
    if (!window.confirm(`Delete "${reference.name}" from the custom reference list? Existing measurement files keep their saved label.`)) return;
    deleteReference.mutate({ referenceId: reference.id }, {
      onSuccess: async () => {
        await invalidateReferences();
        if (editingId === reference.id) {
          setEditingId(null);
          setEditingName('');
        }
        toast({ title: 'Custom reference deleted', description: 'Existing measurement files keep their saved label.' });
      },
      onError: () => toast({
        title: 'Could not delete custom reference',
        description: 'The reference list was not changed. Try again.',
        variant: 'destructive',
      }),
    });
  };

  return (
    <details className="rounded-xl border border-border/70 bg-muted/20 p-3" data-testid="manager-measurement-references">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        Manage custom references <span className="font-normal text-muted-foreground">({customReferences.length})</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[10px] leading-4 text-muted-foreground">Custom reference names are shared across measurement files. Removing one does not erase labels already saved on files.</p>
        {error && <p className="text-xs text-destructive">Reference choices could not be loaded. Refresh and try again.</p>}
        <form className="flex flex-wrap gap-2" onSubmit={addReference}>
          <Input
            className="h-9 min-w-48 flex-1 text-xs"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={160}
            placeholder="New custom reference"
            aria-label="New custom reference name"
            data-testid="input-new-measurement-reference"
          />
          <Button type="submit" size="sm" disabled={!newName.trim() || createReference.isPending || loading || error} data-testid="button-add-measurement-reference">
            <Plus size={14} /> Add
          </Button>
        </form>
        {loading
          ? <p className="text-xs text-muted-foreground">Loading reference options…</p>
          : customReferences.length === 0
            ? <p className="text-xs text-muted-foreground">No custom references yet.</p>
            : <ul className="space-y-2" aria-label="Custom measurement references">
                {customReferences.map((reference) => (
                  <li key={reference.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-2" data-testid={`row-measurement-reference-${reference.id}`}>
                    {editingId === reference.id ? (
                      <>
                        <Input
                          className="h-8 min-w-40 flex-1 text-xs"
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          maxLength={160}
                          aria-label={`Edit custom reference ${reference.name}`}
                          data-testid={`input-edit-measurement-reference-${reference.id}`}
                        />
                        <Button type="button" size="sm" disabled={!editingName.trim() || updateReference.isPending} onClick={() => saveReference(reference)} data-testid={`button-save-measurement-reference-${reference.id}`}>
                          <Save size={13} /> Save
                        </Button>
                        <Button type="button" size="icon" variant="ghost" aria-label="Cancel edit" disabled={updateReference.isPending} onClick={() => { setEditingId(null); setEditingName(''); }}>
                          <X size={14} />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-40 flex-1 text-xs font-medium">{reference.name}</span>
                        <Button type="button" size="sm" variant="outline" disabled={updateReference.isPending || deleteReference.isPending} onClick={() => { setEditingId(reference.id); setEditingName(reference.name); }} data-testid={`button-edit-measurement-reference-${reference.id}`}>
                          <Pencil size={13} /> Edit
                        </Button>
                        <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={updateReference.isPending || deleteReference.isPending} onClick={() => removeReference(reference)} data-testid={`button-delete-measurement-reference-${reference.id}`}>
                          <Trash2 size={13} /> Delete
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>}
      </div>
    </details>
  );
}

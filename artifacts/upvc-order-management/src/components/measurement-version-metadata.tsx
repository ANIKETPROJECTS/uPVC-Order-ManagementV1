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
    if ((kind !== 'user' && kind !== 'custom' && kind !== 'customer') || !id || value === selectedReferenceValue) return;
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
            {references.some((reference) => reference.kind === 'customer') && (
              <SelectGroup>
                <SelectLabel>Customers</SelectLabel>
                {references.filter((reference) => reference.kind === 'customer').map((reference) => (
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

type ManagedReferenceKind = 'custom' | 'customer';

function MeasurementReferenceCollectionManager({
  kind,
  title,
  singularLabel,
  references,
  loading,
  error,
}: {
  kind: ManagedReferenceKind;
  title: string;
  singularLabel: string;
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
  const managedReferences = references.filter((reference) => reference.kind === kind);
  const testPrefix = kind === 'custom' ? 'measurement-reference' : 'customer-reference';

  const invalidateReferences = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListMeasurementReferencesQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListMeasurementRecordsQueryKey() }),
  ]);

  const addReference = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createReference.mutate({ data: { name, kind } }, {
      onSuccess: async () => {
        await invalidateReferences();
        setNewName('');
        toast({ title: `${singularLabel} added`, description: `${name} can now be selected for measurement files.` });
      },
      onError: () => toast({
        title: `Could not add ${singularLabel.toLowerCase()}`,
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
        toast({ title: `${singularLabel} updated`, description: 'Files using this reference now show its new name.' });
      },
      onError: () => toast({
        title: `Could not update ${singularLabel.toLowerCase()}`,
        description: 'Choose a unique name and try again.',
        variant: 'destructive',
      }),
    });
  };

  const removeReference = (reference: MeasurementReferenceOption) => {
    if (!window.confirm(`Delete "${reference.name}" from the ${title.toLowerCase()} list? Existing measurement files keep their saved label.`)) return;
    deleteReference.mutate({ referenceId: reference.id }, {
      onSuccess: async () => {
        await invalidateReferences();
        if (editingId === reference.id) {
          setEditingId(null);
          setEditingName('');
        }
        toast({ title: `${singularLabel} deleted`, description: 'Existing measurement files keep their saved label.' });
      },
      onError: () => toast({
        title: `Could not delete ${singularLabel.toLowerCase()}`,
        description: 'The reference list was not changed. Try again.',
        variant: 'destructive',
      }),
    });
  };

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card p-3" data-testid={`section-${testPrefix}-manager`}>
      <div>
        <h4 className="text-xs font-semibold text-foreground">{title} <span className="font-normal text-muted-foreground">({managedReferences.length})</span></h4>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">These names are independent from staff users and client records. Removing one does not erase labels already saved on files.</p>
      </div>
      {error && <p className="text-xs text-destructive">Reference choices could not be loaded. Refresh and try again.</p>}
      <form className="flex flex-wrap gap-2" onSubmit={addReference}>
        <Input
          className="h-9 min-w-48 flex-1 text-xs"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={160}
          placeholder={`New ${singularLabel.toLowerCase()} name`}
          aria-label={`New ${singularLabel.toLowerCase()} name`}
          data-testid={`input-new-${testPrefix}`}
        />
        <Button type="submit" size="sm" disabled={!newName.trim() || createReference.isPending || loading || error} data-testid={`button-add-${testPrefix}`}>
          <Plus size={14} /> Add
        </Button>
      </form>
      {loading
        ? <p className="text-xs text-muted-foreground">Loading reference options…</p>
        : managedReferences.length === 0
          ? <p className="text-xs text-muted-foreground">No {title.toLowerCase()} yet.</p>
          : <ul className="space-y-2" aria-label={title}>
              {managedReferences.map((reference) => (
                <li key={reference.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card p-2" data-testid={`row-${testPrefix}-${reference.id}`}>
                  {editingId === reference.id ? (
                    <>
                      <Input
                        className="h-8 min-w-40 flex-1 text-xs"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={160}
                        aria-label={`Edit ${singularLabel.toLowerCase()} ${reference.name}`}
                        data-testid={`input-edit-${testPrefix}-${reference.id}`}
                      />
                      <Button type="button" size="sm" disabled={!editingName.trim() || updateReference.isPending} onClick={() => saveReference(reference)} data-testid={`button-save-${testPrefix}-${reference.id}`}>
                        <Save size={13} /> Save
                      </Button>
                      <Button type="button" size="icon" variant="ghost" aria-label="Cancel edit" disabled={updateReference.isPending} onClick={() => { setEditingId(null); setEditingName(''); }}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-40 flex-1 text-xs font-medium">{reference.name}</span>
                      <Button type="button" size="sm" variant="outline" disabled={updateReference.isPending || deleteReference.isPending} onClick={() => { setEditingId(reference.id); setEditingName(reference.name); }} data-testid={`button-edit-${testPrefix}-${reference.id}`}>
                        <Pencil size={13} /> Edit
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={updateReference.isPending || deleteReference.isPending} onClick={() => removeReference(reference)} data-testid={`button-delete-${testPrefix}-${reference.id}`}>
                        <Trash2 size={13} /> Delete
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>}
    </section>
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
  if (!canEdit) return null;

  const customReferences = references.filter((reference) => reference.kind === 'custom');
  const customerReferences = references.filter((reference) => reference.kind === 'customer');

  return (
    <details className="rounded-xl border border-border/70 bg-muted/20 p-3" data-testid="manager-measurement-references">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        Manage custom and customer references <span className="font-normal text-muted-foreground">({customReferences.length} custom · {customerReferences.length} customers)</span>
      </summary>
      <div className="mt-3 space-y-3">
        <MeasurementReferenceCollectionManager kind="custom" title="Custom references" singularLabel="Custom reference" references={references} loading={loading} error={error} />
        <MeasurementReferenceCollectionManager kind="customer" title="Customer references" singularLabel="Customer reference" references={references} loading={loading} error={error} />
      </div>
    </details>
  );
}

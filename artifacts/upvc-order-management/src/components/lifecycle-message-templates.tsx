import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  getListOrderMessageTemplatesQueryKey,
  useUpdateOrderMessageTemplate,
} from '@workspace/api-client-react';
import type { OrderMessageTemplate } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';

const templateSchema = z.object({ template: z.string().min(10, 'Message template is too short.') });

type LifecycleMessageTemplatesProps = {
  templates: OrderMessageTemplate[];
  canEdit: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

export function LifecycleMessageTemplates({ templates, canEdit, loading, error, onRetry }: LifecycleMessageTemplatesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateOrderMessageTemplate();
  const [selected, setSelected] = useState<OrderMessageTemplate['status'] | null>(null);
  const active = templates.find((item) => item.status === selected) || templates[0];
  const form = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: { template: '' },
  });

  useEffect(() => {
    if (active) form.reset({ template: active.template });
  }, [active?.status, active?.template, form]);

  if (loading) {
    return <Card className="border-border/80" data-testid="state-templates-loading">
      <CardContent className="space-y-3 p-6">
        <div className="h-4 w-44 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted/70" />
      </CardContent>
    </Card>;
  }
  if (error) {
    return <Card className="border-destructive/20 bg-destructive/5" data-testid="state-templates-error">
      <CardContent className="flex items-center justify-between gap-4 p-6">
        <div>
          <p className="text-sm font-bold">Templates unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">Shared lifecycle copy could not be loaded.</p>
        </div>
        <Button onClick={onRetry} size="sm" variant="outline" data-testid="button-retry-templates">
          <RefreshCw size={13} /> Retry
        </Button>
      </CardContent>
    </Card>;
  }
  if (!active) {
    return <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground" data-testid="state-templates-empty">
      No lifecycle templates have been configured.
    </div>;
  }

  const save = (values: z.infer<typeof templateSchema>) => update.mutate(
    { status: active.status, data: values },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListOrderMessageTemplatesQueryKey() });
        toast({ title: 'Template saved', description: `${active.label} now uses the updated message.` });
      },
      onError: (cause) => toast({
        title: 'Template could not be saved',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        variant: 'destructive',
      }),
    },
  );

  return (
    <Card className="border-border/80" data-testid="card-lifecycle-templates">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Order workflow</p>
            <CardTitle className="mt-1 text-base">Lifecycle message templates</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Shared copy used for the order status messages.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] font-bold text-primary">
            <ShieldCheck size={13} /> {canEdit ? 'Master Admin control' : 'Read only'}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="space-y-1" role="tablist" aria-label="Lifecycle stages">
            {templates.map((item) => (
              <button
                type="button"
                key={item.status}
                onClick={() => setSelected(item.status)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${item.status === active.status ? 'bg-sidebar text-sidebar-foreground' : 'hover:bg-muted'}`}
                data-testid={`button-template-stage-${item.status}`}
              >
                <span>{item.label}</span><ChevronDown size={13} className="-rotate-90 opacity-50" />
              </button>
            ))}
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(save)} className="space-y-3" data-testid="form-template">
              <FormField
                control={form.control}
                name="template"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{active.label} message</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={6} readOnly={!canEdit} className="resize-y font-mono text-xs leading-5" data-testid={`input-template-${active.status}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    <span className="font-semibold text-foreground">Variables:</span> {'{{clientName}}'} · {'{{orderId}}'} · {'{{locationName}}'} · {'{{status}}'} · {'{{dispatch_code}}'} · {'{{lot_no}}'} · {'{{vehicle_no}}'}
                  </p>
                  <div className="flex flex-wrap gap-1.5" aria-label="Insert dispatch template variable">
                    {['dispatch_code', 'lot_no', 'vehicle_no'].map((variable) => <Button key={variable} type="button" size="sm" variant="outline" className="h-7 px-2 text-[9px]" disabled={!canEdit} onClick={() => {
                      const current = form.getValues('template');
                      const token = `{{${variable}}}`;
                      form.setValue('template', `${current}${current && !current.endsWith(' ') ? ' ' : ''}${token}`, { shouldDirty: true, shouldValidate: true });
                    }} data-testid={`button-insert-template-${variable}`}>+ {variable}</Button>)}
                  </div>
                </div>
                {canEdit && (
                  <Button type="submit" size="sm" disabled={update.isPending} data-testid="button-save-template">
                    {update.isPending ? 'Saving…' : 'Save shared template'}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </div>
      </CardContent>
    </Card>
  );
}

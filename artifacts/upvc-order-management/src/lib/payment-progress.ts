export function calculatePaymentProgress(orderValue: number | null | undefined, paid: number) {
  const balance = orderValue == null ? null : orderValue - paid;
  const percentage = orderValue == null || orderValue === 0
    ? 0
    : Math.round((paid / orderValue) * 1000) / 10;
  return { paid, balance, percentage };
}

export function paymentProgressTone(percentage: number) {
  if (percentage < 30) return 'bg-rose-500';
  if (percentage < 100) return 'bg-amber-500';
  return 'bg-emerald-500';
}
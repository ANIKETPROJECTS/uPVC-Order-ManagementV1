import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOrderQueryKey,
  getGetPaymentOverviewQueryKey,
  getListOrderActivityQueryKey,
  getListOrderPaymentFlagsQueryKey,
  getListOrdersQueryKey,
  getListPaymentFlagsQueryKey,
  useUpdateOrderBilling,
} from "@workspace/api-client-react";
import type { OrderDocument, User } from "@workspace/api-client-react";

const formatInr = (amount: number) => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
}).format(amount);

export function parseConfirmationBillingAmount(value: string): number | null {
  const normalizedAmount = value
    .replace(/₹|INR|Rs\.?/gi, "")
    .replace(/[\s,]/g, "")
    .replace(/\/-?$/, "")
    .trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalizedAmount)) return null;

  const parsedAmount = Number(normalizedAmount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;

  const roundedAmount = Math.round((parsedAmount + Number.EPSILON) * 100) / 100;
  return Number.isFinite(roundedAmount) && roundedAmount > 0 ? roundedAmount : null;
}

export function useSyncConfirmationOrderValue(orderId: string, user: User) {
  const queryClient = useQueryClient();
  const updateBilling = useUpdateOrderBilling();
  const canEditPayments = user.roleId === "master-admin" || user.permissions?.payments === "edit";

  return useCallback(async (documentRecord?: OrderDocument | null): Promise<string | null> => {
    const info = documentRecord?.confirmationInfo;
    if (!info) return null;

    const finalAmountField = info.sections
      .flatMap((section) => section.fields)
      .find((field) => /^final\s+billing\s+(?:amount|amt\.?)$/i.test(field.label.trim()));
    if (!finalAmountField) return "No Final Billing Amount was found; the saved order value was left unchanged.";

    const amount = parseConfirmationBillingAmount(finalAmountField.value);
    if (amount === null) {
      return "The extracted Final Billing Amount is invalid; the saved order value was left unchanged.";
    }
    if (!canEditPayments) {
      return `${formatInr(amount)} was extracted, but Payments edit access is required to update the saved order value.`;
    }

    try {
      const updated = await updateBilling.mutateAsync({ id: orderId, data: { orderValue: amount, allowOverpayment: true } });
      queryClient.setQueryData(getGetOrderQueryKey(orderId), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListOrderActivityQueryKey(orderId) }),
        queryClient.invalidateQueries({ queryKey: getGetPaymentOverviewQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListPaymentFlagsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListOrderPaymentFlagsQueryKey(orderId) }),
      ]);
      return `Total order value updated to ${formatInr(amount)} from Final Billing Amount.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The billing update was rejected.";
      return `Could not update the saved order value: ${message}`;
    }
  }, [canEditPayments, orderId, queryClient, updateBilling]);
}

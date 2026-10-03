export type PermissionValue = 'none' | 'view' | 'edit';

export type ModuleDefinition = {
  key: string;
  label: string;
  short: string;
  built?: boolean;
};

export const MODULES: ModuleDefinition[] = [
  { key: 'user-access', label: 'Multi-User Architecture & Role-Based Access Control', short: 'User access', built: true },
  { key: 'order-hub', label: 'Client & Order ID Management (Central Hub)', short: 'Client & orders', built: true },
  { key: 'quotation-builder', label: 'Quotation & Rate Approval', short: 'Quotation & approval', built: true },
  { key: 'rate-approval', label: 'Rate Approval Queue', short: 'Approval queue' },
  { key: 'confirmation', label: 'Confirmation / Purchase Order Register', short: 'Confirmation / PO', built: true },
  { key: 'measurements', label: 'Measurement Database (Version Control)', short: 'Measurements', built: true },
  { key: 'qr-assembly', label: 'QR Code Generation & Assembly Tracking', short: 'QR assembly' },
  { key: 'window-readiness', label: 'Window-wise Readiness Tracking', short: 'Window readiness' },
  { key: 'glass-procurement', label: 'Glass Tracking', short: 'Glass tracking', built: true },
  { key: 'payments', label: 'Order Value & Payment Tracking', short: 'Payments', built: true },
  { key: 'balance-payment', label: 'Balance Payment Automated Message Generator', short: 'Balance payment' },
  { key: 'dispatch', label: 'Dispatch Status & QR Tracking', short: 'Dispatch', built: true },
  { key: 'installation', label: 'Installation Scheduling', short: 'Installation', built: true },
  { key: 'reporting', label: 'Central Dashboard & Reporting', short: 'Reports' },
];

export const permissionValues: PermissionValue[] = ['none', 'view', 'edit'];

export const permissionLabel = (value: PermissionValue | undefined) =>
  value === 'edit' ? 'Edit' : value === 'view' ? 'View' : 'None';
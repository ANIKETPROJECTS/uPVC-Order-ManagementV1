export type PermissionValue = 'none' | 'view' | 'edit';

export type ModuleDefinition = {
  key: string;
  label: string;
  short: string;
  built?: boolean;
};

export const MODULES: ModuleDefinition[] = [
  { key: 'user-access', label: 'Multi-User Architecture & Role-Based Access Control', short: 'People and permissions', built: true },
  { key: 'order-hub', label: 'Client & Order ID Management (Central Hub)', short: 'Order book' },
  { key: 'quotation-builder', label: 'Digital Quotation Builder & Document Repository', short: 'Quotes' },
  { key: 'rate-approval', label: 'Rate Approval Workflow', short: 'Pricing review' },
  { key: 'confirmation', label: 'Digital Confirmation / Purchase Order Generator', short: 'Order sign-off' },
  { key: 'measurements', label: 'Measurement Database (Version Control)', short: 'Site dimensions' },
  { key: 'qr-assembly', label: 'QR Code Generation & Assembly Tracking', short: 'Factory floor' },
  { key: 'window-readiness', label: 'Window-wise Readiness Tracking', short: 'Production checks' },
  { key: 'glass-procurement', label: 'Glass Procurement & Delivery Tracking', short: 'Glass orders' },
  { key: 'payments', label: 'Order Value & Payment Tracking', short: 'Accounts' },
  { key: 'balance-payment', label: 'Balance Payment Automated Message Generator', short: 'Final balances' },
  { key: 'dispatch', label: 'Dispatch QR Scan & WhatsApp Payment Alert Gate', short: 'Delivery planning' },
  { key: 'installation', label: 'Installation Scheduling', short: 'Site work' },
  { key: 'reporting', label: 'Central Dashboard & Reporting', short: 'Insights' },
];

export const permissionValues: PermissionValue[] = ['none', 'view', 'edit'];

export const permissionLabel = (value: PermissionValue | undefined) =>
  value === 'edit' ? 'Edit' : value === 'view' ? 'View' : 'None';
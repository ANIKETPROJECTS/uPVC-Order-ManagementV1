export type SidebarIconName =
  | 'brand'
  | 'overview'
  | 'user-access'
  | 'order-hub'
  | 'quotation-builder'
  | 'rate-approval'
  | 'confirmation'
  | 'measurements'
  | 'qr-assembly'
  | 'window-readiness'
  | 'glass-procurement'
  | 'payments'
  | 'balance-payment'
  | 'dispatch'
  | 'installation'
  | 'roles';

type SidebarSectionIconProps = {
  name: SidebarIconName;
  size?: number;
  className?: string;
};

const accents: Record<SidebarIconName, string> = {
  brand: '#4ED6C0',
  overview: '#65B8FF',
  'user-access': '#C49BFF',
  'order-hub': '#59C7E8',
  'quotation-builder': '#B69BFF',
  'rate-approval': '#FFC568',
  confirmation: '#60D6A3',
  measurements: '#FFA867',
  'qr-assembly': '#70B4FF',
  'window-readiness': '#54D6C3',
  'glass-procurement': '#78D9F2',
  payments: '#FFD06B',
  'balance-payment': '#9E91FF',
  dispatch: '#FF977D',
  installation: '#73D4A6',
  roles: '#F4AE65',
};

export function SidebarSectionIcon({ name, size = 19, className = '' }: SidebarSectionIconProps) {
  const accent = accents[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="22" height="22" rx="7" fill={accent} fillOpacity=".14" />
      {name === 'brand' && (
        <g>
          <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="#183C46" stroke="#4ED6C0" strokeWidth="1" />
          <rect x="7" y="7" width="5" height="5" rx="1.2" fill="#5DD5E5" />
          <rect x="13.5" y="7" width="4" height="5" rx="1.2" fill="#A78BFA" />
          <rect x="7" y="13.5" width="5" height="4" rx="1.2" fill="#FFC568" />
          <rect x="13.5" y="13.5" width="4" height="4" rx="1.2" fill="#58D5A5" />
        </g>
      )}
      {name === 'overview' && (
        <g>
          <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.8" fill="#67C8FF" />
          <rect x="13" y="4.5" width="6.5" height="4.5" rx="1.6" fill="#A78BFA" />
          <rect x="13" y="11.5" width="6.5" height="8" rx="1.8" fill="#5BD5B0" />
          <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.8" fill="#FFC568" />
        </g>
      )}
      {name === 'user-access' && (
        <g>
          <circle cx="9.5" cy="8.5" r="3.1" fill="#83DDF0" />
          <path d="M3.8 18.8c.4-3.4 2.4-5.2 5.7-5.2 2.5 0 4.3 1 5.2 3" fill="#9E87FF" />
          <path d="m17.2 11.8 3.4 1.4v2.5c0 2.1-1.2 3.6-3.4 4.7-2.2-1.1-3.4-2.6-3.4-4.7v-2.5l3.4-1.4Z" fill="#FFC568" />
          <path d="m15.8 15.8 1 1 1.9-2" stroke="#3B3347" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {name === 'order-hub' && (
        <g>
          <rect x="5.5" y="5" width="13" height="15" rx="2" fill="#E4F5FF" />
          <rect x="9" y="3.5" width="6" height="3.5" rx="1.5" fill="#FF9A7D" />
          <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" stroke="#4F9FD2" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="18.2" cy="18" r="2.3" fill="#5BD5B0" />
        </g>
      )}
      {name === 'quotation-builder' && (
        <g>
          <path d="M6 4.5h8l4 4v10.8a.7.7 0 0 1-.7.7H6.7a.7.7 0 0 1-.7-.7V5.2a.7.7 0 0 1 .7-.7Z" fill="#EEE8FF" />
          <path d="M14 4.8v4h3.8" stroke="#8B73D9" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8.5 12h7M8.5 15h5.5M8.5 18h4" stroke="#8F79E3" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M5 7.5v12a1 1 0 0 0 1 1h8" stroke="#C2AEFF" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      )}
      {name === 'rate-approval' && (
        <g>
          <circle cx="11.3" cy="11.4" r="7" fill="#FFD779" />
          <path d="m8.6 14.3 5.3-5.8M9 8.3h.1M14 14.5h.1" stroke="#9B6530" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="18.2" cy="17.8" r="3.3" fill="#5BD5B0" />
          <path d="m16.7 17.8 1 1 1.9-2" stroke="#174A42" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {name === 'confirmation' && (
        <g>
          <path d="M5.5 4.5h8l4 4v10.8a.7.7 0 0 1-.7.7H6.2a.7.7 0 0 1-.7-.7V5.2a.7.7 0 0 1 .7-.7Z" fill="#E2FFF0" />
          <path d="M13.5 4.8v4h3.8" stroke="#48A67A" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8.2 12h4.5" stroke="#55B58A" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="15.8" cy="16.2" r="3.7" fill="#5BD5A5" />
          <path d="m14.1 16.1 1.1 1.1 2.3-2.4" stroke="#155A42" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {name === 'measurements' && (
        <g>
          <path d="m5 7 12 12" stroke="#FFC568" strokeWidth="4.5" strokeLinecap="round" />
          <path d="m6.2 7.8 1.4-1.4m1.5 4.3 1.2-1.2m1.5 4.3 1.2-1.2m1.5 4.3 1.3-1.3" stroke="#8F5E38" strokeWidth="1" strokeLinecap="round" />
          <path d="m17.4 5.1 1.5 1.5-9.6 9.6-1.5-1.5 9.6-9.6Z" fill="#78C8FF" stroke="#4D9BD2" strokeWidth=".7" />
          <path d="m15.8 7.5 1.7 1.7m-3.7.3 1.3 1.3m-3.3.7 1.1 1.1" stroke="#E9F7FF" strokeWidth=".9" strokeLinecap="round" />
        </g>
      )}
      {name === 'qr-assembly' && (
        <g>
          <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" fill="#73C8FF" />
          <rect x="6.4" y="6.4" width="2.2" height="2.2" rx=".4" fill="#193F62" />
          <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" fill="#C0A0FF" />
          <rect x="15.4" y="6.4" width="2.2" height="2.2" rx=".4" fill="#493873" />
          <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" fill="#65D7B1" />
          <rect x="6.4" y="15.4" width="2.2" height="2.2" rx=".4" fill="#1C6250" />
          <path d="M14 14h2v2h-2zm4 0h2v4h-2zm-4 4h2v2h-2z" fill="#FFC568" />
        </g>
      )}
      {name === 'window-readiness' && (
        <g>
          <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="#DDF8FF" stroke="#59BFD2" strokeWidth="1" />
          <path d="M12 5v14M5 12h14" stroke="#5ABAD0" strokeWidth="1.3" />
          <path d="m14.5 16 1.4 1.4 3.1-3.4" stroke="#45B887" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="17.8" cy="17.5" r="3.2" fill="#67D6A4" fillOpacity=".95" />
          <path d="m16.5 17.5.9.9 1.8-2" stroke="#155A42" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {name === 'glass-procurement' && (
        <g>
          <path d="M6 5h12l-1.5 14h-9L6 5Z" fill="#98E4F5" fillOpacity=".72" stroke="#5DB9D5" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8 7.5 9 17M14 7l-1 9" stroke="#E9FCFF" strokeWidth="1.2" strokeLinecap="round" />
          <path d="m7.3 6.8 3.1-1.2" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="17.6" cy="17.8" r="2.6" fill="#FFC568" />
        </g>
      )}
      {name === 'payments' && (
        <g>
          <rect x="4" y="6" width="16" height="12" rx="2.4" fill="#91D7FF" />
          <path d="M4.7 9.5h14.6" stroke="#397DAB" strokeWidth="1.5" />
          <path d="M7 14h4" stroke="#316C91" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="17" cy="15.2" r="2.1" fill="#FFD16D" />
        </g>
      )}
      {name === 'balance-payment' && (
        <g>
          <path d="M6 4.5h9l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" fill="#EEE9FF" />
          <path d="M14.5 4.8v3h3" stroke="#8A79D3" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 11h6M8 14h4" stroke="#9181DD" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="17.3" cy="16.9" r="3.6" fill="#6CD6AA" />
          <path d="M17.3 14.9v4m1.2-3.1c0-.5-.5-.8-1.2-.8s-1.2.3-1.2.8.5.8 1.2.8 1.2.3 1.2.8-.5.8-1.2.8-1.2-.3-1.2-.8" stroke="#1D674D" strokeWidth=".9" strokeLinecap="round" />
        </g>
      )}
      {name === 'dispatch' && (
        <g>
          <path d="M3.5 7h10v9h-10z" fill="#FFB29D" />
          <path d="M13.5 10h4l3 3v3h-7v-6Z" fill="#74CFFF" />
          <path d="M15.2 11.5v2h3.6" stroke="#E8F8FF" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="7.2" cy="17" r="2.1" fill="#EAF7FF" stroke="#526A7E" strokeWidth="1" />
          <circle cx="17.3" cy="17" r="2.1" fill="#EAF7FF" stroke="#526A7E" strokeWidth="1" />
          <path d="M3.5 16h1.6m4.2 0h4.2" stroke="#B86F61" strokeWidth="1.2" />
        </g>
      )}
      {name === 'installation' && (
        <g>
          <path d="m4 11 8-6.5 8 6.5" stroke="#7FE0B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.2 10v9h11.6v-9" fill="#DDF8E8" stroke="#56B98E" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 19v-5h4v5" fill="#9CCBFF" />
          <path d="m16 5.5 2.6 2.6m-1.2-3.7 2.3 2.3" stroke="#FFC568" strokeWidth="1.7" strokeLinecap="round" />
        </g>
      )}
      {name === 'roles' && (
        <g>
          <path d="m12 3.7 7 2.7v5.1c0 4.3-2.7 7.3-7 9.3-4.3-2-7-5-7-9.3V6.4l7-2.7Z" fill="#CBB7FF" />
          <path d="m8.5 11.7 2.2 2.2 4.8-5" stroke="#55428C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18.5" cy="17.5" r="3.1" fill="#FFC568" />
          <circle cx="18.5" cy="17.5" r=".9" fill="#805D31" />
        </g>
      )}
    </svg>
  );
}
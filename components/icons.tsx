// Iconos propios: trazo 1.5, caja 16×16, heredan color (currentColor).
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}><path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H10v-4H6v4H3a.5.5 0 0 1-.5-.5V7Z" /></Svg>
);
export const IconOrders = (p: P) => (
  <Svg {...p}><path d="M3 2.5h10v11H3z" /><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" /></Svg>
);
export const IconMoney = (p: P) => (
  <Svg {...p}><rect x="1.5" y="4" width="13" height="8.5" rx="1.5" /><circle cx="8" cy="8.25" r="1.75" /><path d="M4 6.5v3.5M12 6.5v3.5" /></Svg>
);
export const IconAccounts = (p: P) => (
  <Svg {...p}><path d="M2.5 5.5h11M2.5 10.5h11" /><circle cx="5.5" cy="5.5" r="1.5" fill="var(--bg-app)" /><circle cx="10.5" cy="10.5" r="1.5" fill="var(--bg-app)" /></Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}><path d="m6.5 4.5 3.5 3.5-3.5 3.5" /></Svg>
);
export const IconChevronLeft = (p: P) => (
  <Svg {...p}><path d="m9.5 4.5-3.5 3.5 3.5 3.5" /></Svg>
);
export const IconArrowRight = (p: P) => (
  <Svg {...p}><path d="M3 8h10M9 4l4 4-4 4" /></Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}><path d="m4 4 8 8M12 4l-8 8" /></Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></Svg>
);
export const IconPrinter = (p: P) => (
  <Svg {...p}><path d="M4.5 6V2.5h7V6" /><rect x="2" y="6" width="12" height="5.5" rx="1" /><path d="M4.5 9.5h7v4h-7z" /></Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}><path d="m3 8.5 3 3 7-7" /></Svg>
);
export const IconRefresh = (p: P) => (
  <Svg {...p}><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}><path d="M8 2 14.5 13.5h-13L8 2Z" /><path d="M8 6.5v3M8 11.5v.01" /></Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}><path d="M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6M10.5 11 13.5 8l-3-3M13.5 8h-7" /></Svg>
);
export const IconPhone = (p: P) => (
  <Svg {...p}><path d="M5.5 2.5h-2a1 1 0 0 0-1 1C2.5 9 7 13.5 12.5 13.5a1 1 0 0 0 1-1v-2l-2.5-1-1.25 1.25A6 6 0 0 1 5.75 6.75L7 5.5l-1.5-3Z" /></Svg>
);
export const IconMail = (p: P) => (
  <Svg {...p}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4 5.5-4" /></Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Z" /><circle cx="8" cy="6.5" r="1.5" /></Svg>
);
export const IconTruck = (p: P) => (
  <Svg {...p}><path d="M1.5 4h8v7h-8zM9.5 6.5h2.75L14.5 9v2h-5" /><circle cx="4.5" cy="11.75" r="1.25" fill="var(--bg-surface)" /><circle cx="11.5" cy="11.75" r="1.25" fill="var(--bg-surface)" /></Svg>
);
export const IconStore = (p: P) => (
  <Svg {...p}><path d="M2.5 6.5v7h11v-7M1.5 6.5 3 2.5h10l1.5 4H1.5ZM6.5 13.5v-4h3v4" /></Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>
);
export const IconFilter = (p: P) => (
  <Svg {...p}><path d="M2 3.5h12M4.5 8h7M6.5 12.5h3" /></Svg>
);

/** 공통 아이콘 (선 아이콘, currentColor) */
const svg = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const ShieldIcon = () => (
  <svg {...svg} className="shield">
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.700-7-5.500-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const PersonIcon = () => (
  <svg {...svg} width={44} height={44} strokeWidth={1.6}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.600-6 8-6s8 2 8 6" />
  </svg>
);
export const MicIcon = () => (
  <svg {...svg}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const MicOffIcon = () => (
  <svg {...svg}>
    <path d="M15 9.500V6a3 3 0 0 0-5.700-1.300M9 9v2a3 3 0 0 0 4.500 2.600" />
    <path d="M5 11a7 7 0 0 0 11 5.700M19 11a7 7 0 0 1-.500 2.600M12 18v3M4 4l16 16" />
  </svg>
);
export const HangupIcon = () => (
  <svg {...svg}>
    <path d="M3 14.500c0-1 .400-2 1.200-2.600C6.300 10.300 9 9.500 12 9.500s5.700.800 7.800 2.400c.800.600 1.200 1.600 1.200 2.600v1a1 1 0 0 1-1.300 1l-2.900-.900a1 1 0 0 1-.700-1v-1.500a10 10 0 0 0-8.200 0v1.500a1 1 0 0 1-.700 1l-2.900.900a1 1 0 0 1-1.300-1v-1z" />
  </svg>
);
export const LinkIcon = () => (
  <svg {...svg}>
    <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
  </svg>
);

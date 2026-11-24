import { useId } from "react";

export function AnalysisGuardian({ state }: { state: "off" | "connecting" | "analyzing" | "listening" | "warning" }) {
  const clipId = useId();
  const warning = state === "warning";
  const outline = "M28 5 45 12v14c0 11-7 18-17 23-10-5-17-12-17-23V12L28 5Z";
  return (
    <svg className="analysis-guardian" data-state={state} data-active={state !== "off" || undefined} viewBox={warning ? "0 0 80 68" : "0 0 72 56"} fill="none" aria-hidden="true" focusable="false">
      <defs><clipPath id={clipId}><path d={outline} /></clipPath></defs>
      <ellipse className="guardian-shadow" cx="28" cy="50" rx="13" ry="3" />
      <g className="guardian-body">
        <path className="guardian-shell" d={outline} strokeWidth="1.5" strokeLinejoin="round" />
        <g clipPath={`url(#${clipId})`}><rect className="guardian-fill" x="11" y="5" width="34" height="44" /></g>
        <path className="guardian-shine" d="m17 16 11-5 10 4" strokeWidth="2" strokeLinecap="round" />
        <rect className="guardian-visor" x="17" y="21" width="22" height="13" rx="6.5" />
        <g className="guardian-eyes"><path d="M23 26v3M33 26v3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></g>
        <path className="guardian-smile" d={warning ? "M25 39q3-2 6 0" : "M25 38q3 3 6 0"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path className="guardian-scan" d="M19 23h18" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        {warning ? <g className="guardian-point"><g transform="rotate(135 51 30)">
          <path d="M41 35q9 7 15-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path className="guardian-hand" d="m53 29-3-5a2.4 2.4 0 0 1 4-2.5l2 3 8-13a2.4 2.4 0 0 1 4 2.6l-5 8 3-1a2.5 2.5 0 0 1 3 3.5l-4 7c-3 5-9 5-12-2.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <g className="guardian-click" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="m66 3 .5 3M74 7l-3 2M76 16l-3-1" />
          </g>
        </g></g> : <g className="guardian-magnifier"><g className="guardian-search">
          <path className="guardian-arm" d="M40 33q5 9 13 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="m58 34 7 8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle className="guardian-lens" cx="52" cy="27" r="9" stroke="currentColor" strokeWidth="2" />
          <path className="guardian-lens-shine" d="M47 26a5 5 0 0 1 5-4" strokeWidth="1.8" strokeLinecap="round" />
        </g></g>}
      </g>
      <g className="guardian-sparks" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M48 8v4M46 10h4M6 29v4M4 31h4" /></g>
    </svg>
  );
}

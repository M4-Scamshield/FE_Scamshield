import type { CSSProperties } from "react";
import { ShieldIcon } from "../common/icons";
import "./LobbyBackground.css";

const waveHeights = [5, 7, 9, 12, 20, 31, 48, 70, 43, 24, 39, 57, 88, 132, 182, 120, 69, 45, 33, 46, 64, 39, 21, 15, 11, 8, 5];

function Waveform({ side }: { side: "left" | "right" }) {
  return (
    <div className={`background-wave background-wave-${side}`}>
      {waveHeights.map((height, index) => (
        <span key={index} style={{
          "--bar-height": `${height}px`,
          "--bar-delay": `${-index * 0.23}s`,
          "--bar-duration": `${1.6 + (index % 5) * 0.19}s`,
        } as CSSProperties} />
      ))}
    </div>
  );
}

/** Decorative only: no microphone access or live audio analysis. */
export function LobbyBackground() {
  return (
    <div className="lobby-background" aria-hidden="true">
      <div className="background-grid" />
      <div className="background-orb orb-blue-top" />
      <div className="background-orb orb-mint" />
      <div className="background-orb orb-blue-bottom" />
      <Waveform side="left" />
      <Waveform side="right" />

      <div className="background-tile phone-tile">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="m6.6 2.8 3 4.4a1.5 1.5 0 0 1-.2 1.9L7.8 11a16.1 16.1 0 0 0 5.2 5.2l1.9-1.6a1.5 1.5 0 0 1 1.9-.2l4.4 3a1.5 1.5 0 0 1 .5 1.8c-.7 1.9-2.3 3-4.3 2.8C9.7 21.2 2.8 14.3 2 6.6c-.2-2 1-3.6 2.8-4.3a1.5 1.5 0 0 1 1.8.5Z" />
        </svg>
      </div>
      <div className="background-tile shield-tile"><ShieldIcon /></div>

      <div className="background-emblem">
        <div className="emblem-shadow" />
        <div className="emblem-floating">
          <svg viewBox="0 0 200 220" fill="none">
            <defs>
              <linearGradient id="lobby-shield-rim" x1="35" y1="20" x2="170" y2="200" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fff" /><stop offset=".45" stopColor="#d2e7ff" /><stop offset="1" stopColor="#649ce3" />
              </linearGradient>
              <linearGradient id="lobby-shield-face" x1="47" y1="50" x2="150" y2="180" gradientUnits="userSpaceOnUse">
                <stop stopColor="#68b2ff" /><stop offset=".5" stopColor="#3978f6" /><stop offset="1" stopColor="#2454c5" />
              </linearGradient>
            </defs>
            <path d="m106 17 73 28v60c0 49-31 82-73 105-42-23-73-56-73-105V45l73-28Z" fill="#1e4c91" />
            <path d="m99 9 73 28v60c0 49-31 82-73 105-42-23-73-56-73-105V37L99 9Z" fill="url(#lobby-shield-rim)" stroke="#e0efff" strokeWidth="2" />
            <path d="m99 29 56 22v46c0 37-22 64-56 85-34-21-56-48-56-85V51l56-22Z" fill="url(#lobby-shield-face)" stroke="#8dc7ff" strokeWidth="2" />
            <path d="m72 101 19 20 36-40" stroke="#1f4b9d" strokeOpacity=".4" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" transform="translate(2 4)" />
            <path d="m72 101 19 20 36-40" stroke="#e7f5ff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m49 54 50-19" stroke="#c4e7ff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="emblem-orbit" />
          <span className="emblem-spark spark-first" /><span className="emblem-spark spark-second" />
        </div>
      </div>

      <div className="background-stars">
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

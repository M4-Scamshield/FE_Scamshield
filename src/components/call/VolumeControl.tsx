import { useId } from "react";
import { MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon } from "../common/icons";

export interface VolumeControlProps {
  label: string;
  value: number;
  max?: number;
  muted: boolean;
  microphone?: boolean;
  onChange: (value: number) => void;
  onToggleMute: () => void;
}

export function VolumeControl({ label, value, max = 1, muted, microphone = false, onChange, onToggleMute }: VolumeControlProps) {
  const id = useId();
  const silent = muted || value === 0;
  return (
    <div className="sound-control" data-muted={muted}>
      <div className="sound-control-head">
        <label htmlFor={id} title={label}>{label}</label>
        <output htmlFor={id}>{muted ? "음소거 · " : ""}{Math.round(value * 100)}%</output>
      </div>
      <div className="sound-control-input">
        <button
          type="button" className="sound-mute" aria-pressed={muted}
          aria-label={`${label} ${muted ? "음소거 해제" : "음소거"}`} onClick={onToggleMute}
        >
          {microphone ? (silent ? <MicOffIcon /> : <MicIcon />) : (silent ? <SpeakerOffIcon /> : <SpeakerIcon />)}
        </button>
        <input
          id={id} type="range" min={0} max={max * 100} step={1} value={Math.round(value * 100)}
          aria-valuetext={`${Math.round(value * 100)}%${muted ? " · 음소거 중" : ""}`}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
      </div>
    </div>
  );
}

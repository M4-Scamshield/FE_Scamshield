import { useEffect, useState } from "react";
import type { PeerView } from "../../services/webrtc/MeshClient";

const STORAGE_KEY = "scamshield.sound.v1";
const DEFAULTS = { microphoneVolume: 1 };

interface PeerSound {
  volume: number;
  muted: boolean;
}

export const DEFAULT_PEER_SOUND: Readonly<PeerSound> = { volume: 1, muted: false };

function volume(value: unknown, fallback: number, max = 1): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      microphoneVolume: volume(saved?.microphoneVolume, 1, 2),
    };
  } catch {
    return DEFAULTS;
  }
}

export function useSoundSettings(peers: PeerView[]) {
  const [settings, setSettings] = useState(readSettings);
  const [peerSounds, setPeerSounds] = useState<Record<string, PeerSound>>({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장을 사용할 수 없어도 현재 통화의 설정은 적용한다.
    }
  }, [settings]);

  useEffect(() => {
    const live = new Set(peers.map((peer) => peer.info.id));
    setPeerSounds((previous) => {
      const entries = Object.entries(previous).filter(([id]) => live.has(id));
      return entries.length === Object.keys(previous).length ? previous : Object.fromEntries(entries);
    });
  }, [peers]);

  return {
    ...settings,
    peerSounds,
    setMicrophoneVolume: (value: number) => setSettings((s) => ({ ...s, microphoneVolume: volume(value, s.microphoneVolume, 2) })),
    setPeerVolume: (id: string, value: number) => setPeerSounds((s) => ({
      ...s,
      [id]: { ...(s[id] ?? DEFAULT_PEER_SOUND), volume: volume(value, 1) },
    })),
    togglePeerMute: (id: string) => setPeerSounds((s) => {
      const previous = s[id] ?? DEFAULT_PEER_SOUND;
      return { ...s, [id]: { ...previous, muted: !previous.muted } };
    }),
  };
}

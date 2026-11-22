import { useEffect, useRef } from "react";
import type { useCall } from "../../hooks/call/useCall";
import { DEFAULT_PEER_SOUND } from "../../hooks/call/useSoundSettings";
import { SpeakerIcon } from "../common/icons";
import { VolumeControl } from "./VolumeControl";

export function SoundSettings({ call }: { call: ReturnType<typeof useCall> }) {
  const { sound, peers, muted, toggleMute } = call;
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <details ref={menuRef} className="sound-menu" onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
      <summary className="round" aria-label="사운드 설정" title="사운드 설정">
        <SpeakerIcon />
      </summary>
      <section className="sound-settings" aria-label="사운드 설정">
        <div className="sound-settings-head"><h2>사운드 설정</h2></div>
        <VolumeControl
          label="내 마이크" value={sound.microphoneVolume} max={2} muted={muted}
          onChange={sound.setMicrophoneVolume} onToggleMute={toggleMute} microphone
        />
        <div className="sound-peer-head"><h3>참가자별 사운드</h3><span>{peers.length}명</span></div>
        {peers.map((peer) => {
          const setting = sound.peerSounds[peer.info.id] ?? DEFAULT_PEER_SOUND;
          return <VolumeControl
            key={peer.info.id} label={peer.info.name} value={setting.volume} muted={setting.muted}
            onChange={(volume) => sound.setPeerVolume(peer.info.id, volume)}
            onToggleMute={() => sound.togglePeerMute(peer.info.id)}
          />;
        })}
      </section>
    </details>
  );
}

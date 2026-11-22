import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VolumeControl, type VolumeControlProps } from "./VolumeControl";

export interface SoundMenuTarget {
  participantId: string;
  x: number;
  y: number;
  trigger: HTMLElement;
}

export function ParticipantSoundMenu({ target, onClose, ...control }: VolumeControlProps & {
  target: SoundMenuTarget;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(target.x, document.documentElement.clientWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)),
    });
    menu.querySelector("input")?.focus({ preventScroll: true });
  }, [target]);

  useEffect(() => {
    const anchor = target.trigger.getBoundingClientRect();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      if (target.trigger.isConnected) target.trigger.focus({ preventScroll: true });
    };
    const closeOnScroll = () => {
      const current = target.trigger.getBoundingClientRect();
      // 창을 열기 전에 발생해 뒤늦게 전달된 scroll 이벤트는 무시한다.
      if (current.left !== anchor.left || current.top !== anchor.top) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, target]);

  return createPortal(
    <div
      ref={ref} id="participant-sound-menu" className="participant-sound-menu"
      role="dialog" aria-label={`${control.label} 사운드 설정`} style={position}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <VolumeControl {...control} />
    </div>,
    document.body,
  );
}

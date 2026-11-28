import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

interface WindowRect { x: number; y: number; width: number; height: number }
type Interaction = "move" | "top-left" | "bottom-right";
const GAP = 12;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useChatWindow(panelRef: RefObject<HTMLDivElement | null>, open: boolean) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [requested, setRequested] = useState<WindowRect | null>(null);
  const [interacting, setInteracting] = useState<Interaction | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; rect: WindowRect } | null>(null);
  const maxWidth = Math.max(0, area.width - GAP * 2);
  const maxHeight = Math.max(0, area.height - GAP * 2);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);

  const constrain = (value: WindowRect): WindowRect => {
    const width = clamp(value.width, minWidth, maxWidth);
    const height = clamp(value.height, minHeight, maxHeight);
    return {
      width, height,
      x: clamp(value.x, GAP, Math.max(GAP, area.width - GAP - width)),
      y: clamp(value.y, GAP, Math.max(GAP, area.height - GAP - height)),
    };
  };
  const rect = constrain(requested ?? {
    width: 340, height: 380,
    x: area.width - GAP - Math.min(340, maxWidth),
    y: area.height - GAP - Math.min(380, maxHeight),
  });

  useLayoutEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      setArea((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      // A resize invalidates the pointer's original coordinate system.
      drag.current = null;
      setInteracting(null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [panelRef]);

  useLayoutEffect(() => {
    if (!open) {
      drag.current = null;
      setInteracting(null);
    }
  }, [open]);

  const update = (start: WindowRect, dx: number, dy: number, mode: Interaction) => {
    if (mode === "move") return constrain({ ...start, x: start.x + dx, y: start.y + dy });
    if (mode === "top-left") {
      const x = clamp(start.x + dx, Math.max(GAP, start.x + start.width - maxWidth), start.x + start.width - minWidth);
      const y = clamp(start.y + dy, Math.max(GAP, start.y + start.height - maxHeight), start.y + start.height - minHeight);
      return { x, y, width: start.width + start.x - x, height: start.height + start.y - y };
    }
    return {
      ...start,
      width: clamp(start.width + dx, minWidth, Math.min(maxWidth, area.width - GAP - start.x)),
      height: clamp(start.height + dy, minHeight, Math.min(maxHeight, area.height - GAP - start.y)),
    };
  };

  const controls = (mode: Interaction) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect };
      setInteracting(mode);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      setRequested(update(start.rect, event.clientX - start.x, event.clientY - start.y, mode));
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      setInteracting(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: () => { drag.current = null; setInteracting(null); },
    onLostPointerCapture: () => { drag.current = null; setInteracting(null); },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 48 : 16;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (!dx && !dy) return;
      event.preventDefault();
      setRequested(update(rect, dx, dy, mode));
    },
  });

  return { rect, interacting, moveProps: controls("move"), resizeProps: controls };
}

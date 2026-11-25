import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useChatResize(drawerRef: RefObject<HTMLDivElement | null>) {
  const [requestedHeight, setRequestedHeight] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ min: 240, max: 480, initial: 396 });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const height = clamp(requestedHeight ?? bounds.initial, bounds.min, bounds.max);

  useLayoutEffect(() => {
    const meeting = drawerRef.current?.closest<HTMLElement>(".meeting");
    if (!meeting) return;
    const head = meeting.querySelector<HTMLElement>(".meeting-head");
    const toolbar = meeting.querySelector<HTMLElement>(".meeting-toolbar");
    const measure = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      // 데스크톱에서는 영상과 도구 공간을 남기고, 모바일에서는 뷰포트를 기준으로 제한한다.
      const available = window.matchMedia("(max-width: 800px)").matches
        ? viewportHeight * .68
        : meeting.clientHeight - (head?.offsetHeight ?? 80) - (toolbar?.offsetHeight ?? 72) - 120;
      const max = Math.max(180, available);
      const min = Math.min(240, max);
      const initial = clamp(Math.min(480, viewportHeight * .46), min, max);
      setBounds((previous) => previous.min === min && previous.max === max && previous.initial === initial ? previous : { min, max, initial });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(meeting);
    if (head) observer.observe(head);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [drawerRef]);

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    height,
    resizing,
    separatorProps: {
      role: "separator",
      tabIndex: 0,
      "aria-label": "채팅창 높이 조절",
      "aria-orientation": "horizontal" as const,
      "aria-controls": "call-chat-panel",
      "aria-valuemin": Math.round(bounds.min),
      "aria-valuemax": Math.round(bounds.max),
      "aria-valuenow": Math.round(height),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, y: event.clientY, height };
        setResizing(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        setRequestedHeight(clamp(drag.current.height + drag.current.y - event.clientY, bounds.min, bounds.max));
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: () => { drag.current = null; setResizing(false); },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        let next: number;
        if (event.key === "ArrowUp") next = height + 24;
        else if (event.key === "ArrowDown") next = height - 24;
        else if (event.key === "Home") next = bounds.min;
        else if (event.key === "End") next = bounds.max;
        else return;
        event.preventDefault();
        setRequestedHeight(clamp(next, bounds.min, bounds.max));
      },
    },
  };
}

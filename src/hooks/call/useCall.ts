import { useCallback, useEffect, useRef, useState } from "react";
import { MeshClient, type CallStatus, type JoinedInfo, type PeerView } from "../../services/webrtc/MeshClient";

export interface JoinOptions {
  room: string;
  name: string;
}

/** MeshClient 를 React 상태로 연결하는 훅 */
export function useCall() {
  const clientRef = useRef<MeshClient | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [joined, setJoined] = useState<JoinedInfo | null>(null);
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [muted, setMuted] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState("");

  const cleanup = () => {
    clientRef.current?.hangup();
    clientRef.current = null;
  };

  const start = useCallback(async ({ room, name }: JoinOptions) => {
    cleanup();
    setError(null);
    setRoom(room);
    setLogs([]);
    setMuted(false);
    setPeers([]);
    setJoined(null);

    const log = (line: string) => setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`]);

    const client = new MeshClient(room, name, {
      onStatus: setStatus,
      onPeers: setPeers,
      onError: setError,
      onLog: log,
      onJoined: setJoined,
    });
    clientRef.current = client;
    // 디버깅용: 콘솔에서 __call.connections 로 확인
    (window as unknown as { __call?: MeshClient }).__call = client;

    try {
      await client.start();
    } catch (e) {
      cleanup();
      setError(`마이크를 켤 수 없음: ${e instanceof Error ? e.message : e} (HTTPS 또는 localhost 필요)`);
    }
  }, []);

  const hangup = useCallback(() => {
    cleanup();
    setPeers([]);
    setJoined(null);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    clientRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  // 페이지를 떠날 때 정리
  useEffect(() => () => cleanup(), []);

  return { status, room, joined, peers, muted, logs, error, start, hangup, toggleMute };
}

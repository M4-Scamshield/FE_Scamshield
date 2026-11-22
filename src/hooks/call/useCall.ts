import { useCallback, useEffect, useRef, useState } from "react";
import { MeshClient, type CallStatus, type JoinedInfo, type PeerView } from "../../services/webrtc/MeshClient";
import { useSoundSettings } from "./useSoundSettings";

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
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const sound = useSoundSettings(peers);
  const microphoneVolumeRef = useRef(sound.microphoneVolume);
  microphoneVolumeRef.current = sound.microphoneVolume;

  useEffect(() => {
    clientRef.current?.setMicrophoneVolume(sound.microphoneVolume);
  }, [sound.microphoneVolume]);

  const cleanup = () => {
    clientRef.current?.hangup();
    clientRef.current = null;
    setMicStream(null);
    setCamera(null);
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
    client.setMicrophoneVolume(microphoneVolumeRef.current);
    // 디버깅용: 콘솔에서 __call.connections 로 확인
    (window as unknown as { __call?: MeshClient }).__call = client;

    try {
      await client.start();
      if (clientRef.current === client) setMicStream(client.micStream);
    } catch (e) {
      if (clientRef.current !== client) return;
      cleanup();
      setError(`마이크를 켤 수 없음: ${e instanceof Error ? e.message : e} (HTTPS 또는 localhost 필요)`);
    }
  }, []);

  const hangup = useCallback(() => {
    cleanup();
    setPeers([]);
    setJoined(null);
  }, []);

  const toggleCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.setCamera(!client.camera);
      setCamera(client.camera);
    } catch (e) {
      setError(`카메라를 켤 수 없음: ${e instanceof Error ? e.message : e}`);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    clientRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  // 페이지를 떠날 때 정리
  useEffect(() => () => cleanup(), []);

  return { status, room, joined, peers, muted, micStream, camera, logs, error, sound, start, hangup, toggleMute, toggleCamera };
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisEventsUrl,
  createAnalysisCall,
  sendAnalysisInput,
  type AnalysisCall,
  type InputType,
} from "../../api/analysis/analysisApi";
import { PcmUploader, type UploaderState } from "../../services/analysis/PcmUploader";
import type { PeerView } from "../../services/webrtc/MeshClient";

/** 위험도 알림. 통화 동안 올라가기만 한다 (SUSPECT → WARN) */
export interface AnalysisAlert {
  eventSeq: number;
  level: "SUSPECT" | "WARN";
  score: number;
  message?: string;
}

/** AI 안내. ACQUIRE = 정보를 받아 달라, VERIFY = 받은 정보를 확인 중 */
export interface AnalysisAction {
  eventSeq: number;
  action: "ACQUIRE" | "VERIFY";
  message: string;
}

export type AnalysisStatus = "off" | "starting" | "on" | "error";

const ME = "me";
const peerTrack = (p: PeerView) => `peer-${p.info.id}`;

/**
 * 보호받는 사람의 브라우저 한 대가 분석을 켠다.
 * 내 마이크(me)와 상대마다의 원격 음성(peer-<id>)을 화자별로 올리고, 결과는 SSE 로 받는다.
 * 상대 브라우저는 아무것도 안 한다 → 토큰을 나눌 필요가 없다.
 */
export function useAnalysis(micStream: MediaStream | null, peers: PeerView[]) {
  const [status, setStatus] = useState<AnalysisStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<AnalysisAlert | null>(null);
  const [action, setAction] = useState<AnalysisAction | null>(null);
  const [tracks, setTracks] = useState<Record<string, UploaderState>>({});
  const callRef = useRef<AnalysisCall | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const uploadersRef = useRef(new Map<string, PcmUploader>());
  const lastSeqRef = useRef(0);

  const onTrackState = useCallback((trackId: string, state: UploaderState, detail?: string) => {
    setTracks((prev) => ({ ...prev, [trackId]: state }));
    if (state === "rejected") setError(`음성 업로드 거절 (${trackId}: ${detail})`);
  }, []);

  const startUpload = useCallback(
    (trackId: string, stream: MediaStream) => {
      const call = callRef.current;
      if (!call || uploadersRef.current.has(trackId)) return;
      const up = new PcmUploader(call, trackId, stream, onTrackState);
      uploadersRef.current.set(trackId, up);
      up.start().catch((e) => {
        uploadersRef.current.delete(trackId);
        setError(`오디오 처리 실패: ${e instanceof Error ? e.message : e}`);
      });
    },
    [onTrackState],
  );

  const stopUpload = useCallback((trackId: string) => {
    uploadersRef.current.get(trackId)?.stop();
    uploadersRef.current.delete(trackId);
    setTracks(({ [trackId]: _, ...rest }) => rest);
  }, []);

  const disable = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    uploadersRef.current.forEach((u) => u.stop());
    uploadersRef.current.clear();
    callRef.current = null;
    lastSeqRef.current = 0;
    setTracks({});
    setAlert(null);
    setAction(null);
    setStatus("off");
  }, []);

  const enable = useCallback(async () => {
    if (callRef.current || !micStream) return;
    setError(null);
    setStatus("starting");
    try {
      const call = await createAnalysisCall();
      callRef.current = call;

      const source = new EventSource(analysisEventsUrl(call));
      sourceRef.current = source;
      // 다시 붙으면 Last-Event-ID 로 놓친 것부터 재생된다. 이미 본 eventSeq 는 버린다
      const fresh = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data.eventSeq <= lastSeqRef.current) return null;
        lastSeqRef.current = data.eventSeq;
        return data;
      };
      source.addEventListener("alert", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) setAlert(d);
      });
      source.addEventListener("action", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) setAction(d);
      });
      source.onopen = () => setStatus("on");

      startUpload(ME, micStream);
      setStatus("on");
    } catch (e) {
      disable();
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [micStream, startUpload, disable]);

  // 상대가 들어오고 나가는 데 맞춰 업로더를 붙이고 뗀다
  useEffect(() => {
    if (status !== "on") return;
    const live = new Set<string>([ME]);
    for (const p of peers) {
      if (!p.stream) continue;
      live.add(peerTrack(p));
      startUpload(peerTrack(p), p.stream);
    }
    for (const id of [...uploadersRef.current.keys()]) if (!live.has(id)) stopUpload(id);
  }, [status, peers, startUpload, stopUpload]);

  // 통화가 끝나면(마이크가 사라지면) 분석도 끈다
  useEffect(() => {
    if (!micStream) disable();
  }, [micStream, disable]);

  useEffect(() => () => disable(), [disable]);

  const reply = useCallback(
    async (inputType: InputType, value: string) => {
      const call = callRef.current;
      if (!call) return;
      try {
        await sendAnalysisInput(call, inputType, value, action?.eventSeq);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [action],
  );

  return { status, error, alert, action, tracks, enable, disable, reply };
}

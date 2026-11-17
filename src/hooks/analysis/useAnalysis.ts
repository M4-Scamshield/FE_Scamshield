import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisEventsUrl,
  createAnalysisCall,
  getAnalysisState,
  sendAnalysisInput,
  type AnalysisCall,
  type InputType,
} from "../../api/analysis/analysisApi";
import { PcmUploader, type UploaderState } from "../../services/analysis/PcmUploader";
import type { PeerView } from "../../services/webrtc/MeshClient";
import type { AnalysisState } from "../../api/analysis/analysisApi";

/** 가장 최근 AI 판단. 정상·오탐 판단은 SSE 로 오지 않아서 상태 API 로 읽는다 */
export interface Judged {
  analyzedTo: number;
  score: number | null;
  action: AnalysisState["action"];
  reason: string | null;
}

const NOT_JUDGED: Judged = { analyzedTo: 0, score: null, action: null, reason: null };

/** 위험도 알림. 통화 동안 올라가기만 한다 (SUSPECT → WARN) */
export interface AnalysisAlert {
  eventSeq: number;
  level: "SUSPECT" | "WARN";
  score: number;
  message?: string;
  /** AI(Gemini)가 쓴 판단 근거 요약 */
  reason?: string | null;
  /** 이 경고의 근거가 된 발화 seq. 전사 화면에서 강조한다 */
  evidenceSeqs?: number[];
}

/**
 * 전사 한 줄. 서버가 접수한 순서(seq) = 에이전트가 판단한 순서로 온다.
 * SPEECH = 화자(trackId)의 확정 발화, INPUT = 사용자가 입력한 링크·문자 (trackId "USER")
 */
export interface TranscriptLine {
  eventSeq: number;
  seq: number;
  kind: "SPEECH" | "INPUT";
  trackId: string;
  text: string;
  inputType?: string | null;
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
  // 받은 경고 전부 (처음 경고 + 같은 단계에서 새로 나온 근거). alert 는 그중 가장 최근 것
  const [warnings, setWarnings] = useState<AnalysisAlert[]>([]);
  const [action, setAction] = useState<AnalysisAction | null>(null);
  const [tracks, setTracks] = useState<Record<string, UploaderState>>({});
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [streamDown, setStreamDown] = useState(false);
  // AI 판단 진행: 어디까지 판단했고 최근 위험도가 얼마인지. 정상 판정은 SSE 로 오지 않아서 상태 API 로 읽는다
  const [judged, setJudged] = useState<Judged>(NOT_JUDGED);
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
    setLines([]);
    setStreamDown(false);
    setJudged(NOT_JUDGED);
    setAlert(null);
    setWarnings([]);
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
      source.addEventListener("utterance", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) setLines((prev) => [...prev, d]);
      });
      source.addEventListener("alert", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) {
          setAlert(d);
          setWarnings((prev) => [...prev, d]);
        }
      });
      // 단계는 그대로인데 AI 가 새 발화에서 다시 피싱으로 판정: 최신 근거·안내로 바꾸고 이력에 쌓는다
      source.addEventListener("warning", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) {
          setAlert(d);
          setWarnings((prev) => [...prev, d]);
        }
      });
      source.addEventListener("action", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) setAction(d);
      });
      source.onopen = () => {
        setStatus("on");
        setStreamDown(false);
      };
      // EventSource 가 알아서 다시 붙는다. 그동안 화면이 "듣는 중"으로 남지 않게 표시만 한다
      source.onerror = () => setStreamDown(true);

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

  // 정상 판정은 이벤트가 없으니 켜져 있는 동안 1.5초마다 판단 진행을 읽는다
  useEffect(() => {
    if (status !== "on") return;
    const tick = async () => {
      const call = callRef.current;
      if (!call) return;
      try {
        const s = await getAnalysisState(call);
        if (callRef.current === call)
          setJudged({
            analyzedTo: s.analyzed_to ?? 0,
            score: s.current_score ?? null,
            action: s.action ?? null,
            reason: s.reason ?? null,
          });
      } catch {
        // 일시 오류는 다음 주기에 다시 읽는다. 연결 끊김 표시는 SSE·업로드 상태가 맡는다
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [status]);

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

  return { status, error, alert, warnings, action, tracks, lines, streamDown, judged, enable, disable, reply };
}

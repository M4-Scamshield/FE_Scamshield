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
import type { JoinedInfo } from "../../services/webrtc/MeshClient";
import type { AnalysisState } from "../../api/analysis/analysisApi";

/** 가장 최근 AI 판단. 정상·오탐 판단은 SSE 로 오지 않아서 상태 API 로 읽는다 */
export interface Judged {
  analyzedTo: number;
  score: number | null;
  action: AnalysisState["action"];
  reason: string | null;
}

const NOT_JUDGED: Judged = { analyzedTo: 0, score: null, action: null, reason: null };

/**
 * AI 가 위험으로 판정한 사기 수법 하나 (예: F1 자산 넘기기).
 * 수법마다 판정 근거·대응 안내·근거가 된 발화가 따로 있다. 서버는 먼저 잡힌 순서로 보낸다
 */
export interface TacticFinding {
  code: string;
  name: string;
  /** 이 수법이 위험도에 더한 점수 */
  points: number;
  reason?: string | null;
  message?: string | null;
  evidenceSeqs: number[];
}

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
  /** 지금까지 위험으로 판정된 수법 전부. 예전 서버는 보내지 않는다 */
  findings?: TacticFinding[];
  /** 브라우저가 이 경고를 받은 시각(ms). 서버는 시각을 보내지 않는다 */
  receivedAt?: number;
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

/**
 * 통화방 하나 = 분석 하나. 참가자 모두가 방에 들어오자마자 분석에 붙는다(토글 없음).
 * 각 브라우저는 자기 마이크만 trackId = 내 참가자 id 로 올린다 → STT 채널 수 = 참가자 수.
 * 결과(전사·경고·안내)는 같은 callId 의 SSE 로 모두가 똑같이 받는다.
 */
export function useAnalysis(micStream: MediaStream | null, joined: JoinedInfo | null) {
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
    if (callRef.current || !micStream || !joined) return;
    setError(null);
    setStatus("starting");
    try {
      const call = await createAnalysisCall(joined.callId);
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
          d.receivedAt = Date.now();
          setAlert(d);
          setWarnings((prev) => [...prev, d]);
        }
      });
      // 단계는 그대로인데 AI 가 새 발화에서 다시 피싱으로 판정: 최신 근거·안내로 바꾸고 이력에 쌓는다
      source.addEventListener("warning", (e) => {
        const d = fresh(e as MessageEvent);
        if (d) {
          d.receivedAt = Date.now();
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

      startUpload(joined.self.id, micStream);
      setStatus("on");
    } catch (e) {
      disable();
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [micStream, joined, startUpload, disable]);

  // 방에 들어와 마이크가 준비되면 통화마다 한 번 자동으로 켠다.
  // 그 뒤 사용자가 토글로 끄면 꺼진 채로 둔다 (다시 켜는 건 토글). 실패해도 자동으로 다시 시도하지 않는다
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!micStream || !joined || autoStartedFor.current === joined.callId) return;
    autoStartedFor.current = joined.callId;
    void enable();
  }, [micStream, joined, enable]);

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

  // 통화가 끝나면(마이크나 방이 사라지면) 분석도 끈다
  useEffect(() => {
    if (!micStream || !joined) disable();
  }, [micStream, joined, disable]);

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

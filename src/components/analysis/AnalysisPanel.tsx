import { useState, type FormEvent } from "react";
import type { useAnalysis } from "../../hooks/analysis/useAnalysis";
import { ShieldIcon } from "../common/icons";

/** 통화 오른쪽 보호 패널: 켜기 토글 · 위험 경고 · AI 안내와 답 입력 */
/** AI 는 화자를 참가자 id(p1, p2 …)로 본다 → 근거 속 id 를 참가자 이름으로 바꿔 보여 준다 */
function withName(reason: string, names: Map<string, string>) {
  return reason.replace(/\[?\b(p\d+)\b\]?/g, (whole, id: string) => names.get(id) ?? whole);
}

export function AnalysisPanel({
  analysis,
  names,
  onSelectSpeaker,
}: {
  analysis: ReturnType<typeof useAnalysis>;
  names: Map<string, string>;
  onSelectSpeaker: (trackId: string) => void;
}) {
  const { status, error, alert, warnings, action, judged, lines, tracks, streamDown, enable, disable, reply } = analysis;
  const on = status === "on" || status === "starting";
  const trackStates = Object.values(tracks);
  const reconnecting = streamDown || trackStates.some((state) => state === "retrying" || state === "stopped" || state === "rejected");
  const protectionState = reconnecting ? "reconnecting" : status === "on" && trackStates.includes("open") ? "listening" : "connecting";
  // JEV 가 의심했지만 Gemini 가 다시 보고 피싱이 아니라고 함: 경고 없이(OBSERVE) 근거만 있다
  const falsePositive = judged.action === "OBSERVE" && !!judged.reason;
  const score = alert?.score ?? judged.score;
  const measured = on && score !== null;
  const riskBand = alert?.level === "WARN" ? "danger" : alert || (measured && score >= 40) ? "caution" : measured ? "safe" : "idle";
  const hasFindings = !!alert || (status === "on" && falsePositive) || !!action;
  const alertReason = alert?.reason || (judged.action === "WARN" ? judged.reason : null);
  const [view, setView] = useState<"risk" | "findings">("risk");
  const [seenFindings, setSeenFindings] = useState<string | null>(null);
  const findingsKey = hasFindings ? JSON.stringify([alert?.eventSeq, action?.eventSeq, judged.reason]) : null;
  const unread = view === "risk" && findingsKey !== null && findingsKey !== seenFindings;
  const pageLink = (
    <button
      type="button" className="analysis-page-link" data-unread={unread || undefined}
      aria-label={view === "risk" ? `분석 결과 및 대응 방안 보기${unread ? " · 새 결과" : ""}` : "통화 위험도 보기"}
      title={view === "risk" ? "분석 결과·대응 방안 보기" : "통화 위험도 보기"}
      aria-controls={view === "risk" ? "analysis-findings" : "analysis-risk"}
      onClick={() => { setSeenFindings(findingsKey); setView(view === "risk" ? "findings" : "risk"); }}
    ><PageArrow previous={view === "findings"} /></button>
  );
  const riskSection = (
    <div className="risk-section">
      <div className="risk-summary" data-risk={riskBand} data-measured={measured}>
        <div className="risk-heading">
          <strong>{!on ? "분석 대기 중" : alert?.level === "WARN" ? "사기 위험 감지" : alert ? "의심 정황 감지" : !measured ? lines.length > 0 ? "위험 신호 분석 중" : "대화 분석 대기 중" : falsePositive ? "재확인 완료 · 피싱 아님" : score >= 40 ? "주의가 필요해요" : "현재 위험도 낮음"}</strong>
          {measured && <span className="risk-number">{score}<small>/ 100</small></span>}
        </div>
        <div className="risk-meter" role={measured ? "meter" : undefined} aria-hidden={!measured || undefined} aria-label={measured ? "통화 위험도" : undefined} aria-valuemin={measured ? 0 : undefined} aria-valuemax={measured ? 100 : undefined} aria-valuenow={measured ? score : undefined}>
          {Array.from({ length: 25 }, (_, segment) => <span key={segment} data-filled={measured && score > segment * 4 || undefined} />)}
        </div>
        <div className="risk-scale" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
        <p>{!on ? "보호를 켜면 통화 속 위험 신호를 실시간으로 감지합니다." : !measured ? "대화가 시작되면 위험도를 표시합니다." : "통화 내용을 바탕으로 AI가 판단한 위험도예요."}</p>
      </div>
    </div>
  );

  return (
    <section className="guard" data-level={alert?.level ?? "none"} data-testid="analysis" data-view={view}>
      <div className="analysis-navigation">
        <h2 className="panel-section-title" id="analysis-view-title">{view === "risk" ? "통화 위험도" : "분석 결과·대응"}</h2>
        {view === "findings" && pageLink}
      </div>

      <div id="analysis-risk" className="guard-page guard-risk" hidden={view !== "risk"} role="region" aria-label="위험도 상세" tabIndex={0}>
        <div className="guard-control">
          <div className="guard-head">
            <div className="guard-label"><ShieldIcon /><span className="guard-title">실시간 보호</span></div>
            <button
              className="switch"
              role="switch"
              aria-label="실시간 보호"
              aria-checked={on}
              onClick={on ? disable : enable}
              disabled={status === "starting"}
              data-testid="analysis-toggle"
            >
              {on ? "ON" : "OFF"}
            </button>
          </div>
          <div className="guard-message-area">
            <p className="guard-message" data-state={on ? protectionState : "off"} role="status">
              {!on ? "필요할 때 다시 켤 수 있어요" : protectionState === "listening" ? "통화를 실시간으로 AI가 분석해요" : protectionState === "reconnecting" ? "분석 연결을 다시 확인하고 있어요" : "분석을 준비하고 있어요"}
            </p>
            {unread && <span className="analysis-result-hint" role="status">분석 결과 확인하기</span>}
            <div className="analysis-switch-row">{view === "risk" && pageLink}</div>
          </div>
        </div>
        {riskSection}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div id="analysis-findings" className="guard-page guard-findings" hidden={view !== "findings"} role="region" aria-label="분석 결과 및 대응 방안" tabIndex={0}>
        {!hasFindings && <div className="findings-empty"><ShieldIcon /><strong>{on ? "분석 결과를 기다리고 있어요" : "보호가 꺼져 있어요"}</strong><p>{on ? "통화 분석 결과와 대응 안내가 이곳에 표시됩니다." : "보호를 켜면 통화 분석 결과를 확인할 수 있어요."}</p></div>}

        {status === "on" && !alert && falsePositive && (
          <div className="why" data-kind="recheck" data-testid="analysis-recheck">
            <p className="why-title">의심 정황이 있었지만 AI가 다시 확인했어요</p>
            <p className="why-text">{withName(judged.reason ?? "", names)}</p>
          </div>
        )}

        {alert && (
          <div className="alert" role="alert" data-testid="analysis-alert">
            <strong>{alert.level === "WARN" ? "사기 위험이 높아요" : "의심스러운 통화예요"}</strong>
            <span>위험도 {alert.score}</span>
          </div>
        )}

        {alert && (
          <div className="why" key={alert.eventSeq} data-fresh={warnings.length > 1 || undefined} data-testid="analysis-reason">
            <div className="why-heading"><p className="why-title" title={warnings.length > 1 ? `최근 판단 기준 · ${warnings.length - 1}번 갱신` : undefined}>AI 판단 근거</p>
            {(alert.evidenceSeqs?.length ?? 0) > 0 && (
              <button className="why-link" type="button" onClick={() => {
                const seq = alert.evidenceSeqs![0];
                showLine(seq);
                const line = lines.find((line) => line.seq === seq);
                if (line?.kind === "SPEECH") onSelectSpeaker(line.trackId);
              }}>
                근거가 된 말 {alert.evidenceSeqs!.length}개 보기
              </button>
            )}
            </div>
            <p className="why-text">{alertReason ? withName(alertReason, names) : "상세 판단 근거를 기다리고 있어요."}</p>
          </div>
        )}

        {hasFindings && <section className="analysis-response" data-testid="analysis-response" aria-label="대응 방안">
          <h3 className="why-title">대응 방안</h3>
        {alert?.message && alert.message !== action?.message && (
          <p className="action-msg">{alert.message}</p>
        )}


        {action && <ActionCard key={action.eventSeq} action={action} onReply={reply} />}
        {!alert?.message && !action && <p className="guard-note">추가 대응 안내가 있으면 여기에 표시됩니다.</p>}
        </section>}

        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

function PageArrow({ previous = false }: { previous?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-previous={previous || undefined}><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** 대화 기록에서 그 발화로 스크롤하고 잠깐 깜빡인다 */
function showLine(seq: number) {
  const el = document.getElementById(`line-${seq}`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function ActionCard({
  action,
  onReply,
}: {
  action: NonNullable<ReturnType<typeof useAnalysis>["action"]>;
  onReply: ReturnType<typeof useAnalysis>["reply"];
}) {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    await onReply(/^https?:\/\//i.test(v) ? "LINK" : "TEXT", v);
    setSent(true);
    setValue("");
  };

  return (
    <div className="action" data-testid="analysis-action">
      <p>{action.message}</p>
      {action.action === "ACQUIRE" &&
        (sent ? (
          <p className="guard-note">보냈어요. 확인 결과를 기다리는 중…</p>
        ) : (
          <form onSubmit={submit}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="상대가 알려 준 기관명·번호·링크"
              aria-label="상대가 알려 준 정보"
            />
            <button className="primary" type="submit">
              확인 요청
            </button>
          </form>
        ))}
    </div>
  );
}

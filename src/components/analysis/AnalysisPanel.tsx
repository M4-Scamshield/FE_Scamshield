import { useState, type FormEvent, type ReactNode } from "react";
import type { AnalysisAlert, TacticFinding, TranscriptLine, useAnalysis } from "../../hooks/analysis/useAnalysis";
import { ShieldIcon } from "../common/icons";
import { AnalysisGuardian } from "../common/AnalysisGuardian";
import { EvidenceList } from "./EvidenceList";

const receiptTimeFormat = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });

/** 통화 오른쪽 보호 패널: 켜기 토글 · 위험 경고 · AI 안내와 답 입력 */
/** AI 는 화자를 참가자 id(p1, p2 …)로 본다 → 근거 속 id 를 참가자 이름으로 바꿔 보여 준다 */
function withName(reason: string, names: Map<string, string>) {
  return reason.replace(/\[?\b(p\d+)\b\]?/g, (whole, id: string) => names.get(id) ?? whole);
}

export function AnalysisPanel({
  analysis,
  names,
  onSelectSpeaker,
  onRevealTranscript,
  statusIndicator,
}: {
  analysis: ReturnType<typeof useAnalysis>;
  names: Map<string, string>;
  onSelectSpeaker: (trackId: string) => void;
  onRevealTranscript: () => void;
  statusIndicator: ReactNode;
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
  const previousWarnings = warnings.filter((warning) => warning.eventSeq !== alert?.eventSeq).reverse();
  const findings = [...(alert?.findings ?? [])].reverse();
  const firstSeen = new Map<string, number | undefined>();
  for (const w of warnings) for (const f of w.findings ?? []) if (!firstSeen.has(f.code)) firstSeen.set(f.code, w.receivedAt);
  const previousCodes = new Set((warnings.at(-2)?.findings ?? []).map((f) => f.code));
  const freshCodes = new Set(warnings.length > 1 ? findings.map((f) => f.code).filter((code) => !previousCodes.has(code)) : []);
  // 직접 펼치거나 접은 것만 기억한다. 손대지 않은 카드는 가장 최근 수법만 펼친다
  const [openTactics, setOpenTactics] = useState<Record<string, boolean>>({});
  const showEvidence = (seqs: number[]) => {
    if (seqs.length === 0) return;
    showLines(seqs, onRevealTranscript);
    const line = lines.find((line) => line.seq === seqs[0]);
    if (line) onSelectSpeaker(line.trackId);
  };
  const [view, setView] = useState<"risk" | "findings">("risk");
  const [seenFindings, setSeenFindings] = useState<string | null>(null);
  const findingsKey = hasFindings ? JSON.stringify([alert?.eventSeq, action?.eventSeq, judged.reason]) : null;
  const unread = view === "risk" && findingsKey !== null && findingsKey !== seenFindings;
  const analyzing = protectionState === "listening" && on && lines.some((line) => line.seq > judged.analyzedTo);
  const guardianState = !on ? "off" : protectionState !== "listening" ? "connecting" : analyzing ? "analyzing" : "listening";
  const guardianText = !on ? "보호 일시 중지" : protectionState === "reconnecting" ? "연결 확인 중" : protectionState !== "listening" ? "분석 준비 중" : analyzing ? "새 발화 분석 중" : "대화를 듣고 있어요";
  const pageLink = (
    <button
      type="button" className="analysis-page-link" data-unread={unread || undefined}
      aria-label={view === "risk" ? `분석 결과 및 대응 방안 보기${unread ? " · 새 결과" : ""}` : "통화 위험도 보기"}
      title={view === "risk" ? "분석 결과·대응 방안 보기" : "통화 위험도 보기"}
      aria-controls={view === "risk" ? "analysis-findings" : "analysis-risk"}
      aria-describedby={unread ? "guardian-result-message" : undefined}
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
        <div className="analysis-navigation-actions">
          {statusIndicator}
          {view === "findings" && pageLink}
        </div>
      </div>

      <div id="analysis-risk" className="guard-page guard-risk" hidden={view !== "risk"} role="region" aria-label="위험도 상세" tabIndex={0}>
        <div className="guard-control">
          <div className="guard-head">
            <div className="guard-label"><AnalysisGuardian state={guardianState} /><span className="guard-title">실시간 보호</span><span className="analysis-state-text" role="status">{guardianText}</span></div>
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
            {unread ? <div className="guardian-speech" id="guardian-result-message" data-warning={!!alert || undefined} role="status">
              <strong>{alert ? "위험 신호를 찾았어요!" : "새 분석 결과가 도착했어요."}</strong>
              <span><b aria-hidden="true">&gt;</b> 버튼을 눌러 결과를 확인하세요.</span>
            </div> : <p className="guard-message" data-state={on ? protectionState : "off"} role="status">
              {!on ? "필요할 때 다시 켤 수 있어요" : protectionState === "listening" ? "통화를 실시간으로 AI가 분석해요" : protectionState === "reconnecting" ? "분석 연결을 다시 확인하고 있어요" : "분석을 준비하고 있어요"}
            </p>}
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

        {alert && findings.length > 0 && (
          <div className="why tactics" data-testid="analysis-reason">
            <div className="why-heading">
              <h3 className="why-title">위험 수법 {findings.length}개</h3>
            </div>
            <ResultTime receivedAt={alert.receivedAt} latest />
            <ul className="tactic-list" data-testid="analysis-tactics">
              {findings.map((f) => (
                <TacticItem
                  key={f.code} finding={f} names={names} lines={lines}
                  open={openTactics[f.code] ?? f.code === findings[0].code}
                  fresh={freshCodes.has(f.code)}
                  seenAt={firstSeen.get(f.code)}
                  onToggle={() => setOpenTactics((prev) => ({ ...prev, [f.code]: !(prev[f.code] ?? f.code === findings[0].code) }))}
                  onShowEvidence={(seq) => showEvidence([seq])}
                />
              ))}
            </ul>
          </div>
        )}

        {alert && findings.length === 0 && <ReasonCard warning={alert} reason={alertReason} names={names} lines={lines} onSelectSpeaker={onSelectSpeaker} onRevealTranscript={onRevealTranscript} latest />}

        {hasFindings && <section className="analysis-response" data-testid="analysis-response" aria-label="대응 방안">
          <h3 className="why-title">대응 방안</h3>
        {alert?.message && alert.message !== action?.message && (
          <p className="action-msg">{alert.message}</p>
        )}


        {action && <ActionCard key={action.eventSeq} action={action} onReply={reply} />}
        {!alert?.message && !action && <p className="guard-note">추가 대응 안내가 있으면 여기에 표시됩니다.</p>}
        </section>}

        {previousWarnings.length > 0 && <section className="reason-history" aria-label="이전 판단 근거">
          <h3 className="why-title">이전 판단 근거 <span>{previousWarnings.length}건</span></h3>
          <ol className="reason-history-list">
            {previousWarnings.map((warning) => <li key={warning.eventSeq}>
              <ReasonCard warning={warning} reason={warning.reason} names={names} lines={lines} onSelectSpeaker={onSelectSpeaker} onRevealTranscript={onRevealTranscript} />
            </li>)}
          </ol>
        </section>}

        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

function ReasonCard({ warning, reason, names, lines, onSelectSpeaker, onRevealTranscript, latest = false }: {
  warning: AnalysisAlert;
  reason: string | null | undefined;
  names: Map<string, string>;
  lines: TranscriptLine[];
  onSelectSpeaker: (trackId: string) => void;
  onRevealTranscript: () => void;
  latest?: boolean;
}) {
  const evidenceSeqs = warning.evidenceSeqs ?? [...new Set((warning.findings ?? []).flatMap((finding) => finding.evidenceSeqs))];
  const summary = reason || (warning.findings ?? []).filter((finding) => finding.reason).map((finding) => `${finding.name}: ${finding.reason}`).join("\n");
  return <article className="why" data-latest={latest || undefined} data-testid={latest ? "analysis-reason" : "analysis-history-reason"}>
    <div className="why-heading">
      <p className="why-title">{latest ? "AI 판단 근거" : `${warning.level === "WARN" ? "위험 감지" : "주의 감지"} · 위험도 ${warning.score}`}</p>
    </div>
    <ResultTime receivedAt={warning.receivedAt} latest={latest} />
    <p className="why-text">{summary ? withName(summary, names) : "상세 판단 근거를 기다리고 있어요."}</p>
    <EvidenceList seqs={evidenceSeqs} lines={lines} names={names} onSelect={(seq) => {
      showLines([seq], onRevealTranscript);
      const line = lines.find((line) => line.seq === seq);
      if (line) onSelectSpeaker(line.trackId);
    }} />
  </article>;
}

function ResultTime({ receivedAt, latest = false }: { receivedAt: number; latest?: boolean }) {
  const received = new Date(receivedAt);
  return <div className="reason-received">
    {latest && <span className="reason-latest">최신</span>}
    <time dateTime={received.toISOString()} title={`분석 결과: ${received.toLocaleString("ko-KR")}`}>{receiptTimeFormat.format(received)}</time>
    <span>분석 결과</span>
  </div>;
}

function PageArrow({ previous = false }: { previous?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-previous={previous || undefined}><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** 대화 기록에서 첫 근거 발화로 스크롤하고, 근거 발화를 모두 잠깐 깜빡인다 */
function showLines(seqs: number[], onRevealTranscript: () => void) {
  // 필터에 가려진 발화도 근거 버튼에서 즉시 찾을 수 있게 전체 보기를 먼저 복원한다.
  onRevealTranscript();
  const els = seqs.map((seq) => document.getElementById(`line-${seq}`)).filter((el): el is HTMLElement => !!el);
  if (els.length === 0) return;
  els[0].scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  for (const el of els) {
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}

/** 위험 수법 한 줄. 누르면 판단 근거·대응 안내·근거가 된 말 버튼이 펼쳐진다 */
function TacticItem({
  finding,
  names,
  lines,
  open,
  fresh,
  seenAt,
  onToggle,
  onShowEvidence,
}: {
  finding: TacticFinding;
  names: Map<string, string>;
  lines: TranscriptLine[];
  open: boolean;
  fresh: boolean;
  seenAt?: number;
  onToggle: () => void;
  onShowEvidence: (seq: number) => void;
}) {
  const bodyId = `tactic-${finding.code}`;
  // 점수 몫으로 무게를 나눈다: 40 = 돈·정보·이동 요구, 25 = 고립, 10 = 분위기 조성
  const weight = finding.points >= 40 ? "high" : finding.points >= 20 ? "mid" : "low";
  return (
    <li className="tactic" data-open={open || undefined} data-weight={weight} data-testid={`tactic-${finding.code}`}>
      <button type="button" className="tactic-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="tactic-name">{finding.name}{fresh && <em className="tactic-new">새로 감지</em>}</span>
        <span className="tactic-points" aria-label={`위험도에 ${finding.points}점 더함`}>+{finding.points}</span>
        <span className="tactic-share" aria-hidden="true"><i style={{ width: `${Math.min(100, finding.points)}%` }} /></span>
        <TacticChevron />
      </button>
      <div className="tactic-body" id={bodyId} hidden={!open}>
        <div className="tactic-body-inner">
          {seenAt !== undefined && <ResultTime receivedAt={seenAt} />}
          <p className="tactic-reason">{finding.reason ? withName(finding.reason, names) : "판단 근거가 아직 없어요."}</p>
          {finding.message && <p className="tactic-advice"><span>대응</span>{withName(finding.message, names)}</p>}
          <EvidenceList seqs={finding.evidenceSeqs} lines={lines} names={names} onSelect={onShowEvidence} />
        </div>
      </div>
    </li>
  );
}

function TacticChevron() {
  return <svg className="tactic-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
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

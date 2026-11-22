import { useState, type FormEvent } from "react";
import type { useAnalysis } from "../../hooks/analysis/useAnalysis";

/** 통화 오른쪽 보호 패널: 켜기 토글 · 위험 경고 · AI 안내와 답 입력 */
/** 분석 서버는 근거 앞에 누구 말 때문인지 "[peer-<id>]" 를 붙인다 → 참가자 이름으로 바꿔 보여 준다 */
function withName(reason: string, names: Map<string, string>) {
  return reason.replace(/^\[([^\]]+)\] /, (whole, track: string) => (names.has(track) ? `[${names.get(track)}] ` : whole));
}

export function AnalysisPanel({
  analysis,
  names,
}: {
  analysis: ReturnType<typeof useAnalysis>;
  names: Map<string, string>;
}) {
  const { status, error, alert, warnings, action, judged, lines, enable, disable, reply } = analysis;
  const on = status === "on" || status === "starting";
  // JEV 가 의심했지만 Gemini 가 다시 보고 피싱이 아니라고 함: 경고 없이(OBSERVE) 근거만 있다
  const falsePositive = judged.action === "OBSERVE" && !!judged.reason;
  const score = alert?.score ?? judged.score;
  const measured = on && score !== null;
  const riskBand = alert?.level === "WARN" ? "danger" : alert || (measured && score >= 40) ? "caution" : measured ? "safe" : "idle";

  return (
    <section className="guard" data-level={alert?.level ?? "none"} data-testid="analysis">
      <div className="guard-head">
        <span className="guard-title">실시간 보호</span>
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

      <div className="risk-section">
        <h2 className="panel-section-title">통화 위험도</h2>
        <div className="risk-summary" data-risk={riskBand} data-measured={measured}>
          <div className="risk-heading">
            <strong>{!on ? "분석 대기 중" : alert?.level === "WARN" ? "사기 위험 감지" : alert ? "의심 정황 감지" : !measured ? lines.length > 0 ? "위험 신호 분석 중" : "대화 분석 대기 중" : falsePositive ? "재확인 완료 · 피싱 아님" : score >= 40 ? "주의가 필요해요" : "현재 위험도 낮음"}</strong>
            {measured && <span className="risk-number">{score}<small>/ 100</small></span>}
          </div>
          {measured && <div className="risk-meter" role="meter" aria-label="통화 위험도" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
            {[0, 1, 2, 3].map((segment) => <span key={segment} data-filled={score > segment * 25 || undefined} />)}
          </div>}
          <p>{!on ? <>보호를 활성화하면<br />위험 신호를 감지합니다.</> : !measured ? <>대화가 시작되면<br />위험 신호를 실시간으로 살펴봅니다.</> : "통화 내용을 바탕으로 AI가 판단한 위험도예요."}</p>
        </div>
      </div>

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

      {alert && (alert.reason ?? (judged.action === "WARN" ? judged.reason : null)) && (
        <div className="why" key={alert.eventSeq} data-fresh={warnings.length > 1 || undefined} data-testid="analysis-reason">
          <p className="why-title">
            왜 위험한가요 · AI 판단 근거
            {/* AI 는 통화 전체를 보고 판단한다. 새 발화마다 근거가 최신 대화 기준으로 다시 쓰인다 */}
            {warnings.length > 1 && <span className="why-meta">최근 판단 기준 · {warnings.length - 1}번 갱신</span>}
          </p>
          <p className="why-text">{withName(alert.reason ?? judged.reason ?? "", names)}</p>
          {(alert.evidenceSeqs?.length ?? 0) > 0 && (
            <button className="why-link" type="button" onClick={() => showLine(alert.evidenceSeqs![0])}>
              근거가 된 말 {alert.evidenceSeqs!.length}개 보기
            </button>
          )}
        </div>
      )}

      {alert?.message && alert.message !== action?.message && (
        <div className="todo">
          <p className="why-title">지금 할 일</p>
          <p className="action-msg">{alert.message}</p>
        </div>
      )}


      {action && <ActionCard key={action.eventSeq} action={action} onReply={reply} />}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** 대화 기록에서 그 발화로 스크롤하고 잠깐 깜빡인다 */
function showLine(seq: number) {
  const el = document.getElementById(`line-${seq}`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
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

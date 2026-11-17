import { useState, type FormEvent } from "react";
import type { useAnalysis } from "../../hooks/analysis/useAnalysis";

/** 통화 화면 아래 붙는 보호 패널: 켜기 토글 · 위험 경고 · AI 안내와 답 입력 */
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

  return (
    <section className="guard" data-level={alert?.level ?? "none"} data-testid="analysis">
      <div className="guard-head">
        <span className="guard-title">사기 탐지</span>
        <button
          className="switch"
          role="switch"
          aria-checked={on}
          onClick={on ? disable : enable}
          disabled={status === "starting"}
          data-testid="analysis-toggle"
        >
          {status === "starting" ? "켜는 중…" : on ? "켜짐" : "꺼짐"}
        </button>
      </div>

      {status === "on" && !alert && (
        <div className="verdict" data-testid="analysis-verdict">
          <span className="verdict-label">AI 판단</span>
          {judged.analyzedTo > 0 && judged.score !== null ? (
            <>
              <strong>{falsePositive ? "피싱 아님" : judged.score >= 40 ? "주의" : "정상"}</strong>
              <span className="verdict-score">위험도 {judged.score}</span>
            </>
          ) : (
            <strong className="verdict-wait">{lines.length > 0 ? "판단 중…" : "대화를 기다리는 중"}</strong>
          )}
        </div>
      )}

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

      {!on && !error && <p className="guard-note">켜면 통화 음성이 분석 서버로 전송돼요. 상대 쪽 설치는 필요 없어요.</p>}
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

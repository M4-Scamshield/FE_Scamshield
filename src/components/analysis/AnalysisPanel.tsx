import { useState, type FormEvent } from "react";
import type { useAnalysis } from "../../hooks/analysis/useAnalysis";

const TRACK_TEXT: Record<string, string> = {
  connecting: "연결 중",
  open: "분석 중",
  retrying: "다시 연결 중",
  stopped: "꺼짐",
  rejected: "거절됨",
};

/** 통화 화면 아래 붙는 보호 패널: 켜기 토글 · 위험 경고 · AI 안내와 답 입력 */
export function AnalysisPanel({ analysis }: { analysis: ReturnType<typeof useAnalysis> }) {
  const { status, error, alert, action, tracks, enable, disable, reply } = analysis;
  const on = status === "on" || status === "starting";

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

      {on && (
        <p className="guard-tracks">
          {Object.entries(tracks).map(([id, s]) => (
            <span key={id}>
              {id === "me" ? "나" : "상대"} · {TRACK_TEXT[s]}
            </span>
          ))}
        </p>
      )}

      {alert && (
        <div className="alert" role="alert" data-testid="analysis-alert">
          <strong>{alert.level === "WARN" ? "사기 위험이 높아요" : "의심스러운 통화예요"}</strong>
          <span>위험도 {alert.score}</span>
        </div>
      )}

      {alert?.message && alert.message !== action?.message && <p className="action-msg">{alert.message}</p>}

      {action && <ActionCard key={action.eventSeq} action={action} onReply={reply} />}

      {!on && !error && <p className="guard-note">켜면 통화 음성이 분석 서버로 전송돼요. 상대 쪽 설치는 필요 없어요.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
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

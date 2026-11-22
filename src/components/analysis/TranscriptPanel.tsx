import { useEffect, useRef } from "react";
import type { TranscriptLine } from "../../hooks/analysis/useAnalysis";

/**
 * 통화 전사. 분석 서버가 받은 순서대로 화자 이름과 함께 쌓는다.
 * 경고의 근거가 된 발화(evidence)는 강조한다. 아래쪽을 보고 있을 때만 새 줄을 따라 내려간다.
 */
export function TranscriptPanel({
  selfId,
  active,
  lines,
  names,
  colors,
  evidence,
  analyzedTo,
  liveTracks,
  onSelectSpeaker,
}: {
  selfId: string | undefined;
  active: boolean;
  lines: TranscriptLine[];
  names: Map<string, string>;
  colors: Map<string, number>;
  evidence: number[];
  analyzedTo: number;
  liveTracks: Set<string>;
  onSelectSpeaker: (trackId: string) => void;
}) {
  const boxRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const box = boxRef.current;
    if (box) stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  };

  const hot = new Set(evidence);

  return (
    <section className="transcript" data-testid="transcript">
      <div className="transcript-head"><h2 className="panel-section-title">대화 기록</h2>{lines.length > 0 && <span>{lines.length}개 발화</span>}</div>
      {lines.length === 0 ? (
        <p className="transcript-empty">{active ? <>대화가 시작되면 화자별로<br />실시간으로 표시됩니다.</> : <>분석에 연결되면 대화 내용이<br />실시간으로 표시됩니다.</>}</p>
      ) : (
        <ol ref={boxRef} className="transcript-lines" onScroll={onScroll} aria-live="polite">
          {lines.map((l) => {
            const selectable = hot.has(l.seq) && l.kind === "SPEECH" && liveTracks.has(l.trackId);
            const speaker = names.get(l.trackId) ?? "참가자";
            const content = <>
              <span className="speaker">
                {speaker}
                <span className="judged" data-done={l.seq <= analyzedTo || undefined}>
                  {l.seq <= analyzedTo ? "AI 확인" : "AI 분석 중…"}
                </span>
              </span>
              <span className="text">{l.text}</span>
            </>;
            return (
              <li
                key={l.eventSeq}
                id={`line-${l.seq}`}
                data-speaker={l.kind === "INPUT" ? "input" : l.trackId === selfId ? "me" : "peer"}
                data-color={l.kind === "INPUT" ? undefined : colors.get(l.trackId)}
                data-evidence={hot.has(l.seq) || undefined}
                data-interactive={selectable || undefined}
              >
                {selectable ? <button
                  type="button" className="transcript-evidence"
                  aria-label={`${speaker}의 탐지된 발화: ${l.text}`}
                  onClick={() => onSelectSpeaker(l.trackId)}
                >{content}</button> : content}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

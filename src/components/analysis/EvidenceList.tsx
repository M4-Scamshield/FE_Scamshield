import { useId, useState } from "react";
import type { TranscriptLine } from "../../hooks/analysis/useAnalysis";

/** 서버의 근거 번호를 화자·발화 미리보기로 풀어 원하는 말을 직접 고른다. */
export function EvidenceList({ seqs, lines, names, onSelect }: {
  seqs: number[];
  lines: TranscriptLine[];
  names: Map<string, string>;
  onSelect: (seq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const listId = useId();
  const uniqueSeqs = [...new Set(seqs)];
  if (uniqueSeqs.length === 0) return null;

  return <div className="evidence-picker">
    <button type="button" className="why-link evidence-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
      근거가 된 말 {uniqueSeqs.length}개 보기
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <ol id={listId} className="evidence-options" aria-label="근거 발화 목록">
      {uniqueSeqs.map((seq) => {
        const line = lines.find((item) => item.seq === seq);
        const speaker = line ? names.get(line.trackId) ?? "참가자" : "대화 기록";
        return <li key={seq}><button type="button" disabled={!line} aria-pressed={selected === seq}
          onClick={() => { setSelected(seq); onSelect(seq); }}>
          <span className="evidence-speaker">{speaker}</span>
          <span className="evidence-preview">{line?.text ?? "대화 기록을 기다리고 있어요."}</span>
          {selected === seq && <span className="evidence-selected">선택됨</span>}
        </button></li>;
      })}
    </ol>}
  </div>;
}

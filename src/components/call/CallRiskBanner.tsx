import { useEffect, useRef } from "react";
import { CloseIcon } from "../common/icons";
import "./CallRiskBanner.css";

export function CallRiskBanner({ onClose, onViewAnalysis }: { onClose: () => void; onViewAnalysis: () => void }) {
  const bannerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !bannerRef.current?.contains(event.target)) previousFocus.current = event.target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  const close = () => {
    onClose();
    if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true });
  };

  return <section ref={bannerRef} className="call-risk-banner" data-testid="call-risk-banner" aria-label="통화 위험 경고">
    <div className="call-risk-message" role="alert" aria-atomic="true">
      <svg className="call-risk-siren" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M8 27V16a8 8 0 0 1 16 0v11H8Z" fill="currentColor" />
        <path d="M4 28h24M16 2v3M4 8l2 2m20 0 2-2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div className="call-risk-copy">
        <h2>보이스피싱 위험 발생</h2>
        <p>보이스피싱 의심 정황이 감지됐어요.<br /><span className="call-risk-action">통화를 종료하고 경찰(112) 또는 금융감독원(1332)에 도움을 요청하세요.</span></p>
        <button type="button" className="call-risk-view" onClick={onViewAnalysis}>실시간 분석 결과 보기</button>
      </div>
    </div>
    <div className="call-risk-controls">
      <button type="button" onClick={close} aria-label="위험 알림 닫기" title="경고 배너 닫기"><CloseIcon /></button>
    </div>
  </section>;
}

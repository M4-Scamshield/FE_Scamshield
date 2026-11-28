import { test, expect, type Page } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
  await context.route("**/api/analysis/calls", (route) => route.fulfill({ json: {
    callId: "test-analysis", token: "test-only", expiresInSeconds: 3600,
  } }));
  await context.route("**/api/analysis/calls/test-analysis", (route) => route.fulfill({ json: {
    current_score: 90, analyzed_to: 5, action: "WARN",
  } }));
  await context.routeWebSocket(/\/ws\/audio\?/, (socket) => socket.onMessage(() => {}));
  await context.addInitScript(() => {
    class TestEvents extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      constructor() {
        super();
        (window as any).__testAnalysisEvents = this;
        queueMicrotask(() => this.onopen?.(new Event("open")));
      }
      close() { (window as any).__testAnalysisEvents = null; }
    }
    (window as any).EventSource = TestEvents;
  });
});

// 분석은 통화에 들어가면 자동으로 켜진다 (토글로 끌 수 있다). trackId = 참가자 id
async function detect(page: Page) {
  await expect.poll(() => page.evaluate(() => !!(window as any).__testAnalysisEvents)).toBe(true);
  await page.evaluate(() => {
    const source = (window as any).__testAnalysisEvents;
    const utterances = [
      { seq: 1, kind: "SPEECH", trackId: "participant-1", text: "계좌를 확인하고 있어요." },
      { seq: 2, kind: "SPEECH", trackId: "participant-2", text: "지금 안전계좌로 이체하세요." },
      { seq: 3, kind: "SPEECH", trackId: "participant-3", text: "확인하고 다시 연락드릴게요." },
      { seq: 4, kind: "INPUT", trackId: "USER", text: "사용자가 입력한 문자" },
      { seq: 5, kind: "SPEECH", trackId: "not-in-call", text: "이전 참가자의 발화" },
    ];
    for (const line of utterances) source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({ ...line, eventSeq: line.seq }) }));
    source.dispatchEvent(new MessageEvent("alert", { data: JSON.stringify({
      eventSeq: 6, level: "WARN", score: 90,
      reason: "안전계좌로 이체하도록 유도했어요.", evidenceSeqs: [2, 1, 4, 5],
    }) }));
  });
  await expect(page.locator("#line-2")).toBeVisible();
}

test("transcript filters by participant ID, receives new speech, and keeps departed speakers", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  const third = await context.newPage();
  await join(third, "아직 말하지 않은 참가자");
  const filters = page.getByRole("group", { name: "대화 기록 화자 필터" });
  const heading = await page.getByRole("heading", { name: "대화 기록", exact: true }).boundingBox();
  const filterBounds = await filters.boundingBox();
  expect(filterBounds!.y).toBe(heading!.y);
  await filters.getByRole("button", { name: "아직 말하지 않은 참가자", exact: true }).click();
  await expect(page.getByTestId("transcript")).toContainText("이 참가자의 대화 기록이 없어요");
  await filters.getByRole("button", { name: "대화 기록 전체", exact: true }).click();
  await detect(page);
  await filters.getByRole("button", { name: "상대방", exact: true }).click();
  await expect(page.locator(".transcript-lines > li")).toHaveCount(1);
  await expect(page.locator("#line-2")).toBeVisible();
  await expect(page.locator("#line-2")).toHaveAttribute("data-evidence", "true");
  await page.evaluate(() => {
    const source = (window as any).__testAnalysisEvents;
    for (const line of [
      { seq: 6, kind: "SPEECH", trackId: "participant-1", text: "다른 화자의 새 발화" },
      { seq: 7, kind: "SPEECH", trackId: "participant-2", text: "선택한 화자의 새 발화" },
    ]) source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({ ...line, eventSeq: line.seq + 1 }) }));
    // 재전송된 이벤트를 중복해서 표시하지 않는다.
    source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({ eventSeq: 8, seq: 7, kind: "SPEECH", trackId: "participant-2", text: "선택한 화자의 새 발화" }) }));
  });
  await expect(page.locator(".transcript-lines > li")).toHaveCount(2);
  await expect(page.locator("#line-7")).toHaveText(/선택한 화자의 새 발화/);
  await expect(page.locator(".transcript-count")).toHaveText("2개 발화");
  await other.getByRole("button", { name: "통화 나가기" }).click();
  await expect(filters.getByRole("button", { name: "상대방 퇴장", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".transcript-lines > li")).toHaveCount(2);
  await page.screenshot({ path: "test-results/transcript-filter.png", fullPage: true });
  await filters.getByRole("button", { name: "대화 기록 전체", exact: true }).click();
  await expect(page.locator(".transcript-lines > li")).toHaveCount(7);
  await expect(page.locator("#line-4")).toContainText("사용자가 입력한 문자");
});

test("evidence shortcuts reveal speech hidden by the selected participant filter", async ({ page, context }) => {
  await join(page, "같은 이름");
  const other = await context.newPage();
  await join(other, "같은 이름");
  await detect(page);
  const filters = page.getByRole("group", { name: "대화 기록 화자 필터" });
  await filters.getByRole("button", { name: "같은 이름 (나)", exact: true }).click();
  await expect(page.locator(".transcript-lines > li")).toHaveCount(1);
  await expect(page.locator("#line-1")).toBeVisible();
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  await page.getByRole("button", { name: "근거가 된 말 4개 보기", exact: true }).click();
  await page.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
  await expect(filters.getByRole("button", { name: "대화 기록 전체", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#line-2")).toHaveClass(/flash/);
  await expect(page.getByTestId("person-participant-2")).toHaveAttribute("data-evidence-active", "true");
});

test("evidence previews select each utterance independently and keep the transcript visible", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  await detect(page);
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const reason = page.getByTestId("analysis-reason");
  const disclosure = reason.getByRole("button", { name: "근거가 된 말 4개 보기", exact: true });
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const options = reason.getByRole("list", { name: "근거 발화 목록" }).getByRole("button");
  await expect(options).toHaveCount(4);
  await expect(options.first()).toContainText("상대방");
  await expect(options.first()).toContainText("지금 안전계좌로 이체하세요.");
  await expect(page.locator(".transcript-lines .flash")).toHaveCount(0);
  const transcriptBefore = await page.getByTestId("transcript").boundingBox();
  for (const [index, seq] of [2, 1, 4, 5].entries()) {
    await options.nth(index).click();
    await expect(options.nth(index)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`#line-${seq}`)).toHaveClass(/flash/);
    await expect(page.locator(`#line-${seq}`)).toBeInViewport();
    expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcriptBefore);
    if (seq === 2 || seq === 1) await expect(page.getByTestId(`person-participant-${seq}`)).toHaveAttribute("data-evidence-active", "true");
    else await expect(page.locator(".person[data-evidence-active]")).toHaveCount(0);
  }
  await page.screenshot({ path: "test-results/evidence-options.png", fullPage: true, animations: "disabled" });
  await disclosure.click();
  await expect(reason.getByRole("list", { name: "근거 발화 목록" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await disclosure.click();
  await options.nth(1).click();
  await expect(page.locator("#line-1")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("risk and findings switch without moving the conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  await detect(page);
  const next = page.getByRole("tab", { name: "분석 결과", exact: true });
  await expect(next).toHaveAttribute("data-unread", "true");
  await expect(page.locator(".guardian-speech")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".guardian-speech")).toContainText("위험 신호를 찾았어요!");
  await expect(page.locator(".guardian-speech")).toContainText("분석 결과 탭에서 확인하세요.");
  await expect(next).toHaveAttribute("aria-describedby", "guardian-result-message");
  await expect(page.getByRole("meter", { name: "통화 위험도" })).toBeInViewport({ ratio: 1 });
  const transcriptBefore = await page.getByTestId("transcript").boundingBox();
  await next.click();
  const reason = page.getByTestId("analysis-reason");
  await expect(reason.locator(".why-title")).toBeInViewport({ ratio: 1 });
  await expect(reason.locator(".why-text")).toBeInViewport({ ratio: 1 });
  await expect(reason.getByRole("button", { name: "근거가 된 말 4개 보기" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "test-results/analysis-results-visible.png", fullPage: true });
  await page.getByRole("tab", { name: "실시간 분석", exact: true }).click();
  await expect(next).not.toHaveAttribute("data-unread");
  await expect(page.locator(".guardian-speech")).toHaveCount(0);
  await expect(page.getByRole("meter", { name: "통화 위험도" })).toBeInViewport({ ratio: 1 });
  expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcriptBefore);
  await expect(page.locator("#line-2 .judged")).toHaveText("위험 신호");
  await expect(page.locator("#line-3 .judged")).toHaveText("AI 확인");
});

test("analysis tabs support keyboard navigation and mark results read while viewing them", async ({ page }) => {
  await join(page, "나");
  await detect(page);
  const live = page.getByRole("tab", { name: "실시간 분석", exact: true });
  const results = page.getByRole("tab", { name: "분석 결과", exact: true });
  await expect(live).toHaveAttribute("aria-selected", "true");
  await expect(results).toHaveAttribute("data-unread", "true");
  const transcript = await page.getByTestId("transcript").boundingBox();
  await live.focus();
  await live.press("ArrowRight");
  await expect(results).toBeFocused();
  await expect(results).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "분석 결과", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
    eventSeq: 7, level: "WARN", score: 95, reason: "새로 확인된 위험 정황입니다.", evidenceSeqs: [2],
  }) })));
  await expect(page.getByTestId("analysis-reason")).toContainText("새로 확인된 위험 정황입니다.");
  await results.press("Home");
  await expect(live).toBeFocused();
  await expect(results).not.toHaveAttribute("data-unread");
  expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcript);
  await live.press("End");
  await expect(results).toHaveAttribute("aria-selected", "true");
  await results.press("ArrowRight");
  await expect(live).toHaveAttribute("aria-selected", "true");
});

test("protection controls remain separate from scrolling analysis content", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await join(page, "나");
  const controls = page.getByRole("group", { name: "실시간 보호 설정" });
  const toggle = page.getByTestId("analysis-toggle");
  const live = page.getByRole("tabpanel", { name: "실시간 분석", exact: true });
  const timeline = page.getByTestId("risk-timeline");
  await expect(timeline).toBeInViewport({ ratio: 1 });
  expect(await controls.evaluate((element) => element.closest('[role="tabpanel"]') === null)).toBe(true);
  expect(await live.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  const before = await toggle.boundingBox();
  const transcriptBefore = await page.getByTestId("transcript").boundingBox();
  await detect(page);
  await page.evaluate(() => (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
    eventSeq: 7, level: "WARN", score: 90, evidenceSeqs: [2], reason: "급하게 송금하도록 유도하고 있습니다. ".repeat(40),
  }) })));
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const results = page.getByRole("tabpanel", { name: "분석 결과", exact: true });
  await results.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await toggle.boundingBox()).toEqual(before);
  await expect(toggle).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("tab", { name: "실시간 분석", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcriptBefore);
  await page.getByRole("tab", { name: "실시간 분석", exact: true }).click();
  await expect(timeline).toBeInViewport({ ratio: 1 });
  expect(await live.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/analysis-protection-separated.png", fullPage: true });
});

test("risk timeline records received scores, leaves failed polling gaps, and resets when protection stops", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let score: number | null = null;
  let analyzedTo = 0;
  let failed = false;
  let failures = 0;
  await context.route("**/api/analysis/calls/test-analysis", (route) => {
    if (failed) { failures++; return route.fulfill({ status: 503, json: {} }); }
    return route.fulfill({ json: { current_score: score, analyzed_to: analyzedTo } });
  });
  await join(page, "나");
  const timeline = page.getByTestId("risk-timeline");
  const point = page.getByTestId("risk-chart-point");
  await expect(timeline).toContainText("분석 결과가 쌓이면 표시돼요");
  await expect(point).toHaveCount(0);
  score = 12; analyzedTo = 1;
  await expect(point).toHaveAttribute("data-score", "12");
  score = 36; analyzedTo = 2;
  await expect(point).toHaveAttribute("data-score", "36");
  await expect(page.getByTestId("risk-chart-segment")).toHaveCount(1);
  failed = true;
  await expect.poll(() => failures).toBeGreaterThan(0);
  await expect(point).toHaveAttribute("data-score", "36");
  failed = false; score = 18; analyzedTo = 3;
  await expect(point).toHaveAttribute("data-score", "18");
  await expect(page.getByTestId("risk-chart-segment")).toHaveCount(2);
  await timeline.focus();
  await timeline.press("Home");
  await expect(timeline).toContainText("12점");
  await timeline.press("ArrowRight");
  await expect(timeline).toContainText("36점");
  await timeline.press("End");
  await expect(timeline).toContainText("18점");
  await page.getByRole("tab", { name: "실시간 분석", exact: true }).focus();
  await page.evaluate(() => {
    const warning = { eventSeq: 1, level: "WARN", score: 70, reason: "의심스러운 송금 요청", evidenceSeqs: [] };
    const source = (window as any).__testAnalysisEvents;
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify(warning) }));
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({ ...warning, score: 99 }) }));
  });
  await expect(point).toHaveAttribute("data-score", "70");
  await expect(page.getByRole("meter", { name: "통화 위험도" })).toHaveAttribute("aria-valuenow", "70");
  await expect(timeline).not.toContainText("99점");
  await page.screenshot({ path: "test-results/analysis-tabs-timeline.png", fullPage: true, animations: "disabled" });
  await page.getByTestId("analysis-toggle").click();
  await expect(point).toHaveCount(0);
  await expect(timeline).toHaveAttribute("data-samples", "0");
  await page.getByTestId("analysis-toggle").click();
  await expect(point).toHaveAttribute("data-score", "18");
  await expect(page.getByTestId("risk-chart-segment")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("evidence is available even when the warning explanation has not arrived", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  await detect(page);
  await page.evaluate(() => {
    (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
      eventSeq: 7, level: "WARN", score: 50, evidenceSeqs: [1], reason: null,
    }) }));
  });
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const reason = page.getByTestId("analysis-reason");
  await expect(reason).toContainText("상세 판단 근거를 기다리고 있어요.");
  const shortcut = reason.getByRole("button", { name: "근거가 된 말 1개 보기" });
  await expect(shortcut).toBeInViewport({ ratio: 1 });
  await shortcut.click();
  await reason.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
  await expect(page.locator("#line-1")).toHaveClass(/flash/);
  await expect(page.getByTestId("person-participant-1")).toHaveAttribute("data-evidence-active", "true");
});

test("updated warnings stack earlier reasons below the latest one", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  await detect(page);
  await page.evaluate(() => {
    const source = (window as any).__testAnalysisEvents;
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
      eventSeq: 7, level: "WARN", score: 95, evidenceSeqs: [2], reason: "인증번호를 불러 달라고 요구했어요.",
    }) }));
  });
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const reason = page.getByTestId("analysis-reason");
  await expect(reason.locator(".why-text")).toHaveText("인증번호를 불러 달라고 요구했어요.");
  await expect(page.getByTestId("analysis-alert")).toContainText("위험도 95");
  await expect(reason.locator(".reason-received")).toContainText("분석 결과");
  const history = page.getByRole("region", { name: "이전 판단 근거", exact: true }).getByTestId("analysis-history-reason");
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText("위험도 90");
  await expect(history.first()).toContainText("안전계좌로 이체하도록 유도했어요.");
});

test("each risky tactic opens its own reason, advice and evidence lines", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  await detect(page);
  const f6 = { code: "F6", name: "권위·절차 연출", points: 10, reason: "서울중앙지검이라며 수사기관을 내세웠어요.", message: "검찰은 전화로 수사하지 않습니다.", evidenceSeqs: [1] };
  const f1 = { code: "F1", name: "자산 넘기기", points: 40, reason: "안전계좌로 이체하라고 요구했어요.", message: "송금하지 말고 전화를 끊으세요.", evidenceSeqs: [2, 3] };
  await page.evaluate(([a, b]) => {
    const source = (window as any).__testAnalysisEvents;
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({ eventSeq: 7, level: "WARN", score: 10, evidenceSeqs: [1], findings: [a] }) }));
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({ eventSeq: 8, level: "WARN", score: 50, evidenceSeqs: [1, 2, 3], findings: [a, b] }) }));
  }, [f6, f1]);
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const reason = page.getByTestId("analysis-reason");
  await expect(reason.locator(".why-title")).toHaveText("위험 수법 2개");
  await expect(reason.locator(":scope > .reason-received")).toContainText("분석 결과");
  const tacticHistory = page.getByTestId("analysis-history-reason").filter({ hasText: f6.reason });
  await expect(tacticHistory).toHaveCount(1);
  await expect(tacticHistory).toContainText("권위·절차 연출");
  await expect(tacticHistory.getByRole("button", { name: "근거가 된 말 1개 보기" })).toHaveCount(1);
  const items = page.getByTestId("analysis-tactics").locator("> li");
  await expect(items).toHaveCount(2);
  // 가장 최근에 잡힌 수법이 위, 혼자 펼쳐져 있다
  const newest = page.getByTestId("tactic-F1");
  const older = page.getByTestId("tactic-F6");
  await expect(items.first()).toHaveAttribute("data-testid", "tactic-F1");
  await expect(newest.getByRole("button", { name: /자산 넘기기/ })).toHaveAttribute("aria-expanded", "true");
  await expect(newest).toContainText("새로 감지");
  await expect(newest).toContainText("+40");
  await expect(newest.locator(".tactic-reason")).toHaveText("안전계좌로 이체하라고 요구했어요.");
  await expect(newest.locator(".tactic-advice")).toContainText("송금하지 말고 전화를 끊으세요.");
  await expect(older.getByRole("button", { name: /권위·절차 연출/ })).toHaveAttribute("aria-expanded", "false");
  await expect(older.locator(".tactic-reason")).toBeHidden();
  await expect(older).not.toContainText("새로 감지");
  await page.screenshot({ path: "test-results/tactics-panel.png", fullPage: true, animations: "disabled" });

  // 펼치면 그 수법의 근거만 보이고, 근거 버튼은 그 수법의 발화만 깜빡인다
  await older.getByRole("button", { name: /권위·절차 연출/ }).click();
  await expect(older.locator(".tactic-reason")).toHaveText("서울중앙지검이라며 수사기관을 내세웠어요.");
  await older.getByRole("button", { name: "근거가 된 말 1개 보기" }).click();
  await older.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
  await expect(page.locator("#line-1")).toHaveClass(/flash/);
  await expect(page.locator("#line-2")).not.toHaveClass(/flash/);
  await newest.getByRole("button", { name: "근거가 된 말 2개 보기" }).click();
  await newest.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").nth(1).click();
  await expect(page.locator("#line-2")).not.toHaveClass(/flash/);
  await expect(page.locator("#line-3")).toHaveClass(/flash/);
  await page.screenshot({ path: "test-results/tactics-panel-open.png", fullPage: true, animations: "disabled" });

  // 접기도 된다. 새 경고가 와도 직접 접은 것은 접힌 채로 둔다
  await newest.getByRole("button", { name: /자산 넘기기/ }).click();
  await expect(newest.locator(".tactic-reason")).toBeHidden();
  await expect(newest.locator(".tactic-chevron")).toHaveCSS("transform", "none");
  await expect(older.locator(".tactic-chevron")).not.toHaveCSS("transform", "none");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/tactics-panel-390.png", fullPage: true, animations: "disabled" });
});

test("evidence selects its speaker by ID, repeats the pulse, and clears after playback", async ({ page, context }) => {
  await join(page, "같은 이름");
  const other = await context.newPage();
  await join(other, "같은 이름");
  const third = await context.newPage();
  await join(third, "같은 이름");
  await detect(page);
  const self = page.getByTestId("person-participant-1");
  const speaker = page.getByTestId("person-participant-2");
  const bystander = page.getByTestId("person-participant-3");

  await page.locator("#line-2 button").click();
  await expect(speaker).toHaveAttribute("data-evidence-active", "true");
  await expect(speaker.getByRole("status")).toContainText("위험 인물입니다.");
  await expect(speaker.getByRole("status")).toContainText("주의하세요!");
  await expect(speaker.locator(".guardian-hand")).toHaveCount(1);
  await expect(speaker.locator(".guardian-magnifier")).toHaveCount(0);
  for (const selector of [".guardian-point", ".speaker-warning-highlight"]) {
    expect(await speaker.locator(selector).evaluate((element) => getComputedStyle(element).animationIterationCount)).toBe("infinite");
  }
  await expect(self).not.toHaveAttribute("data-evidence-active");
  await expect(bystander).not.toHaveAttribute("data-evidence-active");
  await speaker.locator(".speaker-warning-highlight").evaluate((element) => { (window as any).__firstPulse = element; });
  await page.locator("#line-2 button").click();
  expect(await speaker.locator(".speaker-warning-highlight").evaluate((element) => element === (window as any).__firstPulse)).toBe(false);
  await page.screenshot({ path: "test-results/evidence-speaker.png", fullPage: true, animations: "disabled" });

  for (const viewport of [{ width: 900, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator("#line-2 button").click();
    await page.getByTestId("people").screenshot({ path: `test-results/evidence-speaker-${viewport.width}.png`, animations: "disabled" });
    const tile = await speaker.boundingBox();
    const guide = await speaker.locator(".speaker-warning-guide").boundingBox();
    const speech = await speaker.locator(".speaker-warning-speech").boundingBox();
    expect(speech!.x).toBeGreaterThanOrEqual(tile!.x);
    expect(speech!.x + speech!.width).toBeLessThanOrEqual(tile!.x + tile!.width);
    expect(guide!.y).toBeGreaterThanOrEqual(0);
    expect(guide!.y + guide!.height).toBeLessThanOrEqual(tile!.y);
    for (const person of [self, bystander]) {
      const otherTile = await person.boundingBox();
      const overlaps = guide!.x < otherTile!.x + otherTile!.width && guide!.x + guide!.width > otherTile!.x
        && guide!.y < otherTile!.y + otherTile!.height && guide!.y + guide!.height > otherTile!.y;
      expect(overlaps).toBe(false);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator("#line-1 button").press("Enter");
  await expect(self).toHaveAttribute("data-evidence-active", "true");
  await expect(speaker).not.toHaveAttribute("data-evidence-active");
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  await page.getByRole("button", { name: "근거가 된 말 4개 보기" }).click();
  await page.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
  await expect(speaker).toHaveAttribute("data-evidence-active", "true");
  await expect(page.locator("#line-2")).toHaveClass(/flash/);
  await page.waitForTimeout(9000);
  await expect(speaker).toHaveAttribute("data-evidence-active", "true");
  await expect(speaker.locator(".speaker-warning-guide")).toBeVisible();
  await expect(speaker).not.toHaveAttribute("data-evidence-active");
  await expect(page.locator(".speaker-warning-guide")).toHaveCount(0);
  await expect(page.locator("#line-3 button, #line-4 button, #line-5 button")).toHaveCount(0);
  await page.locator("#line-2 button").click();
  await other.getByRole("button", { name: "통화 나가기" }).click();
  await expect(speaker).toHaveCount(0);
  await expect(page.locator("#line-2 button")).toHaveCount(0);
  await expect(bystander).not.toHaveAttribute("data-evidence-active");
});

test("captures the guardian outside all four participant positions", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await join(page, "김민수");
  for (const name of ["이서연", "박지훈", "최유진"]) {
    const participant = await context.newPage();
    await join(participant, name);
  }
  await detect(page);
  await page.evaluate(() => {
    const source = (window as any).__testAnalysisEvents;
    source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
      eventSeq: 7, seq: 6, kind: "SPEECH", trackId: "participant-4", text: "확인을 위해 지금 송금해 주세요.",
    }) }));
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
      eventSeq: 8, level: "WARN", score: 90, evidenceSeqs: [1, 2, 3, 6],
      reason: "송금을 유도하는 발화를 확인했어요.",
    }) }));
  });
  for (const [index, position] of ["top-left", "top-right", "bottom-left", "bottom-right"].entries()) {
    const seq = [1, 2, 3, 6][index];
    const selected = page.getByTestId(`person-participant-${index + 1}`);
    await page.locator(`#line-${seq} button`).click();
    for (const person of await page.locator(".person").all()) await expect(person).toHaveCSS("transform", "none");
    await page.screenshot({ path: `test-results/guardian-${position}.png`, fullPage: true, animations: "disabled" });
    const guide = await selected.locator(".speaker-warning-guide").boundingBox();
    const tile = await selected.boundingBox();
    expect(guide!.y + guide!.height).toBeLessThanOrEqual(tile!.y);
    await expect(selected.locator(".speaker-warning-guide")).toBeInViewport({ ratio: 1 });
    for (let participant = 1; participant <= 4; participant++) {
      const bounds = await page.getByTestId(`person-participant-${participant}`).boundingBox();
      const overlaps = guide!.x < bounds!.x + bounds!.width && guide!.x + guide!.width > bounds!.x
        && guide!.y < bounds!.y + bounds!.height && guide!.y + guide!.height > bounds!.y;
      expect(overlaps).toBe(false);
    }
  }
});

test("reduced motion uses a static warning and disabling analysis clears the highlight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await join(page, "나");
  await detect(page);
  expect(await page.locator(".guardian-search").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  const self = page.getByTestId("person-participant-1");
  await page.locator("#line-1 button").press("Space");
  await expect(self).toHaveAttribute("data-evidence-active", "true");
  expect(await self.locator(".speaker-warning-highlight").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await self.locator(".guardian-point").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.getByTestId("analysis-toggle").click();
  await expect(self).not.toHaveAttribute("data-evidence-active");
  await expect(page.locator(".speaker-warning-guide")).toHaveCount(0);
  await expect(page.getByTestId("transcript").locator("li")).toHaveCount(0);
  // 사용자가 끈 분석은 자동으로 다시 켜지지 않는다 (자동 시작은 통화마다 한 번)
  await page.waitForTimeout(1000);
  await expect(page.getByTestId("analysis-toggle")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("analysis-toggle").click();
  await expect(page.getByTestId("analysis-toggle")).toHaveAttribute("aria-checked", "true");
});

test("collapsed protection badge reflects listening, connection loss, and detected danger", async ({ page }) => {
  await join(page, "나");
  const indicator = page.getByTestId("header-protection");
  await expect(page.getByRole("heading", { name: "회의룸: audio-test", exact: true })).toBeVisible();
  await expect(page.getByTestId("person-participant-1")).toHaveAttribute("data-track", "open");
  await page.getByRole("button", { name: "보호 패널 닫기", exact: true }).click();
  await expect(indicator).toHaveText("ScamShield 보호 중");
  await expect(indicator).toHaveAttribute("data-state", "listening");
  const header = await page.locator(".meeting-head").boundingBox();
  const badge = await indicator.boundingBox();
  expect(Math.abs(badge!.x + badge!.width / 2 - (header!.x + header!.width / 2))).toBeLessThan(1);
  await page.screenshot({ path: "test-results/header-protection.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  const mobileBadge = await indicator.boundingBox();
  expect(Math.abs(mobileBadge!.x + mobileBadge!.width / 2 - 375 / 2)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "test-results/header-protection-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await indicator.click();
  await expect(page.getByRole("complementary", { name: "ScamShield 통화 보호" })).toBeVisible();
  await expect(indicator).toHaveCount(0);
  await page.getByRole("button", { name: "보호 패널 닫기", exact: true }).click();
  await page.evaluate(() => (window as any).__testAnalysisEvents.onerror(new Event("error")));
  await expect(indicator).toHaveText("ScamShield 재연결 중");
  await expect(indicator).toHaveAttribute("data-state", "degraded");
  await page.evaluate(() => (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("alert", { data: JSON.stringify({
    eventSeq: 1, level: "WARN", score: 90, reason: "위험 신호 감지",
  }) })));
  await expect(indicator).toHaveText("ScamShield 위험 감지");
  await expect(indicator).toHaveAttribute("data-state", "WARN");
  await indicator.click();
  await page.getByTestId("analysis-toggle").click();
  await page.getByRole("button", { name: "보호 패널 닫기", exact: true }).click();
  await expect(indicator).toHaveCount(0);
});

test("long analysis keeps conversation visible and evidence navigation preserves both scroll areas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  await detect(page);
  await page.evaluate(() => {
    const source = (window as any).__testAnalysisEvents;
    for (let seq = 6; seq <= 35; seq++) {
      source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
        eventSeq: seq + 1, seq, kind: "SPEECH", trackId: "participant-1", text: `대화를 이어가는 중입니다. ${seq}`,
      }) }));
    }
    source.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
      eventSeq: 37, level: "WARN", score: 90, evidenceSeqs: [1],
      reason: "기관을 사칭하며 급하게 송금하도록 유도하는 대화가 이어지고 있습니다. ".repeat(30),
      message: "요청받은 내용을 확인하세요.",
    }) }));
  });
  const transcript = page.getByTestId("transcript");
  await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
  const analysis = page.getByRole("tabpanel", { name: "분석 결과", exact: true });
  const list = transcript.getByRole("list", { name: "대화 기록", exact: true });
  await expect(list.locator("li")).toHaveCount(35);

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const heading = await transcript.getByRole("heading", { name: "대화 기록" }).boundingBox();
    const bounds = await list.boundingBox();
    expect(bounds!.height).toBeGreaterThan(200);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(heading!.y).toBeGreaterThan(0);
    expect(await analysis.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await page.locator(".safety-content").evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }

  // Following new speech moves only the transcript; the analysis stays where it was read.
  await analysis.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const analysisTop = await analysis.evaluate((element) => element.scrollTop);
  await page.evaluate(() => (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
    eventSeq: 38, seq: 36, kind: "SPEECH", trackId: "participant-1", text: "새로운 대화입니다.",
  }) })));
  await expect(list.locator("li")).toHaveCount(36);
  await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
  expect(await analysis.evaluate((element) => element.scrollTop)).toBe(analysisTop);
  await page.screenshot({ path: "test-results/transcript-long-analysis.png", fullPage: true });

  // The evidence link still reveals an older line without pushing the transcript out of view.
  await page.getByRole("button", { name: "근거가 된 말 1개 보기", exact: true }).click();
  await page.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
  await expect(page.locator("#line-1")).toBeInViewport();
  await expect(page.getByTestId("person-participant-1")).toHaveAttribute("data-evidence-active", "true");

  // Reading older speech must not jump to the newest line when another utterance arrives.
  const readerTop = await list.evaluate((element) => element.scrollTop);
  await page.evaluate(() => (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
    eventSeq: 39, seq: 37, kind: "SPEECH", trackId: "participant-1", text: "이전 대화를 읽는 동안 새로 도착한 발화입니다.",
  }) })));
  await expect(list.locator("li")).toHaveCount(37);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(readerTop);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole("region", { name: "통화 분석", exact: true }).evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  expect(await list.evaluate((element) => element.clientHeight)).toBeGreaterThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test.describe("judgment history", () => {
  test.use({ timezoneId: "Asia/Seoul" });

  test("keeps timestamped reasons, ignores replayed events, and navigates older evidence", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.setFixedTime(new Date("2026-11-24T06:24:00Z"));
    await join(page, "김민수");
    await join(await context.newPage(), "이서연");
    await detect(page);
    await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
    const latest = page.getByTestId("analysis-reason");
    const history = page.getByRole("region", { name: "이전 판단 근거", exact: true });
    await expect(latest.locator("time")).toHaveText("오후 3:24");
    await expect(latest.locator("time")).toHaveAttribute("datetime", "2026-11-24T06:24:00.000Z");

    await page.clock.setFixedTime(new Date("2026-11-24T06:25:00Z"));
    await page.evaluate(() => {
      (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
        eventSeq: 7, level: "WARN", score: 95, reason: "기관을 사칭하며 신분증 사진을 요구했어요.", evidenceSeqs: [1],
      }) }));
    });
    await expect(latest).toContainText("신분증 사진을 요구했어요.");
    await expect(latest.locator("time")).toHaveText("오후 3:25");
    await expect(history.getByTestId("analysis-history-reason")).toHaveCount(1);
    const original = history.getByTestId("analysis-history-reason").filter({ hasText: "안전계좌로 이체하도록 유도했어요." });
    await expect(original.locator("time")).toHaveText("오후 3:24");
    await page.getByRole("complementary", { name: "ScamShield 통화 보호" }).screenshot({ path: "test-results/judgment-history.png", animations: "disabled" });

    await page.clock.setFixedTime(new Date("2026-11-24T06:26:00Z"));
    await page.evaluate(() => {
      (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
        eventSeq: 7, level: "WARN", score: 95, reason: "중복으로 재전송된 이벤트", evidenceSeqs: [1],
      }) }));
    });
    await expect(history.getByTestId("analysis-history-reason")).toHaveCount(1);
    await expect(latest.locator("time")).toHaveText("오후 3:25");
    for (let eventSeq = 8; eventSeq <= 13; eventSeq++) {
      await page.clock.setFixedTime(new Date(Date.UTC(2026, 10, 24, 6, 26 + eventSeq - 8)));
      await page.evaluate((eventSeq) => {
        (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
          eventSeq, level: "WARN", score: 95, reason: `급하게 송금하도록 재촉하고 있어요. 추가 판단 ${eventSeq}`, evidenceSeqs: [1],
        }) }));
      }, eventSeq);
    }
    await expect(history.getByTestId("analysis-history-reason")).toHaveCount(7);
    const findings = page.getByRole("tabpanel", { name: "분석 결과", exact: true });
    expect(await findings.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await original.scrollIntoViewIfNeeded();
    await expect(original).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => {
      (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
        eventSeq: 14, level: "WARN", score: 98, reason: "추가 송금 요구가 확인됐어요.", evidenceSeqs: [1],
      }) }));
    });
    await expect(history.getByTestId("analysis-history-reason")).toHaveCount(8);
    await expect(original).toBeInViewport({ ratio: 1 });
    await expect(original.locator("time")).toHaveText("오후 3:24");
    await original.getByRole("button", { name: "근거가 된 말 4개 보기" }).click();
    await original.getByRole("list", { name: "근거 발화 목록" }).getByRole("button").first().click();
    await expect(page.locator("#line-2")).toHaveClass(/flash/);
    await expect(page.getByTestId("person-participant-2")).toHaveAttribute("data-evidence-active", "true");

    await page.setViewportSize({ width: 390, height: 844 });
    await original.scrollIntoViewIfNeeded();
    // 펼친 미리보기의 소수점 높이로 생기는 1px 미만의 경계 오차는 허용한다.
    await expect(original).toBeInViewport({ ratio: 0.99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("analysis").screenshot({ path: "test-results/judgment-history-mobile.png", animations: "disabled" });
    await page.getByRole("tab", { name: "실시간 분석", exact: true }).click();
    await page.getByTestId("analysis-toggle").click();
    await expect(page.getByTestId("analysis-history-reason")).toHaveCount(0);
    await expect(latest).toHaveCount(0);
  });
});

test("empty conversation stays centered and protection controls stay fixed when toggled", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await join(page, "나");
  const empty = page.locator(".transcript-empty");
  await expect(empty).toContainText("대화가 시작되면");
  await expect(page.locator(".guard-message")).toHaveText("통화를 실시간으로 AI가 분석해요");
  await expect(page.locator(".risk-number")).toBeVisible();
  const controlBefore = await page.locator(".guard-control").boundingBox();
  const labelBefore = await page.locator(".guard-label").boundingBox();
  for (const active of [true, false]) {
    if (!active) await page.getByTestId("analysis-toggle").click();
    await expect(empty).toContainText(active ? "대화가 시작되면" : "분석을 시작하면");
    await expect(page.locator(".risk-number")).toHaveCount(active ? 1 : 0);
    const control = await page.locator(".guard-control").boundingBox();
    const label = await page.locator(".guard-label").boundingBox();
    expect(Math.abs(control!.height - controlBefore!.height)).toBeLessThan(1);
    expect(Math.abs(label!.y - labelBefore!.y)).toBeLessThan(1);
    expect(Math.abs(label!.height - labelBefore!.height)).toBeLessThan(1);
    const area = await empty.boundingBox();
    const text = await empty.locator("span").boundingBox();
    expect(Math.abs(text!.x + text!.width / 2 - (area!.x + area!.width / 2))).toBeLessThan(1);
    expect(Math.abs(text!.y + text!.height / 2 - (area!.y + area!.height / 2))).toBeLessThan(1);
  }
  await page.screenshot({ path: "test-results/transcript-empty-centered.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const area = await empty.boundingBox();
  const text = await empty.locator("span").boundingBox();
  expect(Math.abs(text!.x + text!.width / 2 - (area!.x + area!.width / 2))).toBeLessThan(1);
  await empty.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/transcript-empty-mobile.png", fullPage: true });
});

test.describe("mock panel preview", () => {
  test.use({ deviceScaleFactor: 2 });

  test("captures analyzing, risk, and response views without a backend", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let analyzed = false;
    await context.route("**/api/analysis/calls/test-analysis", (route) => route.fulfill({ json: {
      current_score: analyzed ? 50 : null, analyzed_to: analyzed ? 3 : 0, action: analyzed ? "WARN" : null,
    } }));
    await join(page, "김강욱");
    const other = await context.newPage();
    await join(other, "이수진");
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "listening");
    await page.evaluate(() => {
      const source = (window as any).__testAnalysisEvents;
      const lines = [
        { seq: 1, trackId: "participant-2", text: "서울중앙지검 수사관입니다." },
        { seq: 2, trackId: "participant-2", text: "수사를 위해 안전계좌로 100만 원을 보내세요." },
        { seq: 3, trackId: "participant-1", text: "송금하기 전에 확인해볼게요." },
      ];
      for (const line of lines) source.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
        ...line, kind: "SPEECH", eventSeq: line.seq,
      }) }));
    });
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "analyzing");
    expect(await page.locator(".guardian-body").evaluate((element) => getComputedStyle(element).animationName)).toBe("guardian-bob");
    const sidebar = page.getByRole("complementary", { name: "ScamShield 통화 보호" });
    await sidebar.screenshot({ path: "test-results/mock-panel-analyzing.png", animations: "disabled" });

    analyzed = true;
    await page.evaluate(() => {
      (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("warning", { data: JSON.stringify({
        eventSeq: 4, level: "WARN", score: 50, evidenceSeqs: [2],
        reason: "기관을 사칭하며 안전계좌로 송금을 요구했어요.",
        message: "송금 요청에 응하지 말고, 상대방의 신원을 확인하세요.",
      }) }));
    });
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "listening");
    await expect(page.locator("#line-2 .judged")).toHaveText("위험 신호");
    await expect(page.getByRole("tab", { name: "분석 결과", exact: true })).toHaveAttribute("data-unread", "true");
    await sidebar.screenshot({ path: "test-results/mock-panel-risk.png", animations: "disabled" });
    const transcriptBefore = await page.getByTestId("transcript").boundingBox();
    await page.getByRole("tab", { name: "분석 결과", exact: true }).click();
    await expect(page.getByTestId("analysis-reason")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("analysis-response")).toBeInViewport({ ratio: 1 });
    expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcriptBefore);
    await sidebar.screenshot({ path: "test-results/mock-panel-findings.png", animations: "disabled" });
    await page.screenshot({ path: "test-results/mock-panel-full.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await sidebar.screenshot({ path: "test-results/mock-panel-mobile.png", animations: "disabled" });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("tab", { name: "실시간 분석", exact: true }).click();
    await page.getByTestId("analysis-toggle").click();
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "off");
    await sidebar.screenshot({ path: "test-results/mock-panel-off.png", animations: "disabled" });
    analyzed = false;
    await page.getByTestId("analysis-toggle").click();
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "listening");
    await page.evaluate(() => {
      (window as any).__testAnalysisEvents.dispatchEvent(new MessageEvent("utterance", { data: JSON.stringify({
        eventSeq: 1, seq: 1, kind: "SPEECH", trackId: "participant-2", text: "수사를 위해 안전계좌로 100만 원을 보내세요.",
      }) }));
    });
    await expect(page.locator(".analysis-guardian")).toHaveAttribute("data-state", "analyzing");
    for (let frame = 0; frame < 28; frame++) {
      await page.locator(".guard-control").screenshot({ path: `test-results/guardian-frames/${String(frame).padStart(2, "0")}.png` });
      await page.waitForTimeout(60);
    }
  });
});

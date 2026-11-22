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
  await expect(self).not.toHaveAttribute("data-evidence-active");
  await expect(bystander).not.toHaveAttribute("data-evidence-active");
  await speaker.locator(".speaker-warning-highlight").evaluate((element) => { (window as any).__firstPulse = element; });
  await page.locator("#line-2 button").click();
  expect(await speaker.locator(".speaker-warning-highlight").evaluate((element) => element === (window as any).__firstPulse)).toBe(false);
  await page.screenshot({ path: "test-results/evidence-speaker.png", fullPage: true });

  await page.locator("#line-1 button").press("Enter");
  await expect(self).toHaveAttribute("data-evidence-active", "true");
  await expect(speaker).not.toHaveAttribute("data-evidence-active");
  await page.getByRole("button", { name: "근거가 된 말 4개 보기" }).click();
  await expect(speaker).toHaveAttribute("data-evidence-active", "true");
  await expect(page.locator("#line-2")).toHaveClass(/flash/);
  await expect(speaker).not.toHaveAttribute("data-evidence-active", { timeout: 4000 });
  await expect(page.locator("#line-3 button, #line-4 button, #line-5 button")).toHaveCount(0);
  await page.locator("#line-2 button").click();
  await other.getByRole("button", { name: "통화 나가기" }).click();
  await expect(speaker).toHaveCount(0);
  await expect(page.locator("#line-2 button")).toHaveCount(0);
  await expect(bystander).not.toHaveAttribute("data-evidence-active");
});

test("reduced motion uses a static warning and disabling analysis clears the highlight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await join(page, "나");
  await detect(page);
  const self = page.getByTestId("person-participant-1");
  await page.locator("#line-1 button").press("Space");
  await expect(self).toHaveAttribute("data-evidence-active", "true");
  expect(await self.locator(".speaker-warning-highlight").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.getByTestId("analysis-toggle").click();
  await expect(self).not.toHaveAttribute("data-evidence-active");
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

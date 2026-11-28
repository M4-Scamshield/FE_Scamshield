import { test, expect, type Page } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
  await context.route("**/api/analysis/calls", (route) => route.fulfill({ json: {
    callId: "live-analysis", token: "test-only", expiresInSeconds: 3600,
  } }));
  await context.route("**/api/analysis/calls/live-analysis", (route) => route.fulfill({ json: {
    current_score: 24, analyzed_to: 0, action: "OBSERVE",
  } }));
  await context.routeWebSocket(/\/ws\/audio\?/, (socket) => socket.onMessage(() => {}));
  await context.addInitScript(() => {
    class TestEvents extends EventTarget {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        super();
        (window as any).__testAnalysisEvents = this;
        queueMicrotask(() => this.onopen?.());
      }
      close() { (window as any).__testAnalysisEvents = null; }
    }
    (window as any).EventSource = TestEvents;
  });
});

async function publish(page: Page, type: string, data: Record<string, unknown>) {
  await expect.poll(() => page.evaluate(() => !!(window as any).__testAnalysisEvents)).toBe(true);
  await page.evaluate(({ type, data }) => (window as any).__testAnalysisEvents.dispatchEvent(
    new MessageEvent(type, { data: JSON.stringify(data) }),
  ), { type, data });
}

test("unified header switches screens without replacing the call, camera, audio or analysis session", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await join(page, "나");
  await expect(page.getByRole("tablist", { name: "통화 화면 보기", exact: true })).toHaveCount(1);
  await expect(page.getByRole("tablist").getByRole("tab")).toHaveText(["audio-test 회의실", "실시간 위험도", "AI 분석"]);
  const other = await context.newPage();
  await join(other, "상대방");
  await expect(page.getByTestId("status")).toHaveText("통화 중");
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect(page.locator(".person[data-video='on'] video")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).__preserved = {
      client: (window as any).__call,
      source: (window as any).__testAnalysisEvents,
      video: document.querySelector("video"), audio: document.querySelector("audio"),
      capture: (window as any).__testCapture,
      camera: (window as any).__testVideoCapture,
    };
  });
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  await expect(page.getByTestId("people")).toBeHidden();
  await expect(page.getByRole("heading", { name: "ScamShield", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ScamShield", exact: true }).locator("img")).toHaveAttribute("src", "/logo.png");
  await expect(page.getByRole("meter", { name: "통화 위험도" })).toHaveAttribute("aria-valuenow", "24");
  await expect(page.getByTestId("analysis-verdict")).toBeVisible();
  await expect(page.getByTestId("analysis-verdict")).toHaveAttribute("data-state", "safe");
  await expect(page.getByTestId("analysis-verdict")).toContainText("안전해요");
  const summary = await page.locator(".risk-current").boundingBox();
  const graph = await page.locator(".risk-trend").boundingBox();
  expect(summary!.x + summary!.width).toBeLessThan(graph!.x);
  expect(summary!.width).toBeLessThan(graph!.width);
  await publish(page, "utterance", { eventSeq: 1, seq: 1, kind: "SPEECH", trackId: "participant-2", text: "계좌를 확인해 주세요." });
  await page.getByRole("tab", { name: "AI 분석", exact: true }).click();
  await expect(page.getByTestId("risk-timeline")).toBeHidden();
  await expect(page.getByTestId("transcript")).toContainText("계좌를 확인해 주세요.");
  await expect(page.getByTestId("analysis-verdict")).toBeHidden();
  await expect(page.locator("#analysis-findings")).toContainText("현재까지 감지된 위험이 없습니다.");
  await expect(page.getByRole("heading", { name: "실시간 통화 내용", exact: true })).toBeVisible();
  await expect(page.locator("#line-1 .transcript-avatar")).toHaveText("상");
  const ai = await page.locator("#analysis-findings").boundingBox();
  const stt = await page.getByTestId("transcript").boundingBox();
  expect(ai!.x + ai!.width).toBeLessThan(stt!.x);
  expect(ai!.y).toEqual(stt!.y);
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  await expect(page.getByTestId("risk-timeline")).toBeVisible();
  await expect(page.getByTestId("transcript")).toBeHidden();
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "AI 분석", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "AI 분석", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "AI 분석", exact: true }).press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "실시간 위험도", exact: true })).toBeFocused();
  await expect(page.getByTestId("risk-timeline")).toBeVisible();
  await page.getByRole("button", { name: "음소거", exact: true }).click();
  await page.getByRole("tab", { name: "audio-test 회의실", exact: true }).click();
  await expect(page.getByTestId("people")).toBeVisible();
  expect(await page.evaluate(() => {
    const saved = (window as any).__preserved;
    return saved.client === (window as any).__call && saved.source === (window as any).__testAnalysisEvents
      && saved.video === document.querySelector("video") && saved.audio === document.querySelector("audio")
      && [saved.capture, saved.camera].every((stream) => stream.getTracks().every((track: MediaStreamTrack) => track.readyState === "live"));
  })).toBe(true);
  await expect(page.getByRole("button", { name: "음소거 해제", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "카메라 끄기", exact: true })).toBeVisible();
});

test("warning keeps focus and opens the risk view through its result button", async ({ page }) => {
  await join(page, "나");
  const mute = page.getByRole("button", { name: "음소거", exact: true });
  await mute.focus();
  await publish(page, "warning", { eventSeq: 1, level: "WARN", score: 87, reason: "송금을 요구하고 있어요.", evidenceSeqs: [] });
  await expect(page.getByRole("tab", { name: "AI 분석", exact: true })).toHaveAttribute("data-unread", "true");
  const banner = page.getByTestId("call-risk-banner");
  await expect(banner).toBeVisible();
  await expect(mute).toBeFocused();
  await expect(banner).toHaveCSS("animation-name", "call-risk-breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(banner).toHaveCSS("animation-name", "none");
  await banner.getByRole("button", { name: "실시간 분석 결과 보기", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "실시간 위험도", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".meeting-toolbar .analysis-toggle")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "실시간 위험도", exact: true })).toBeFocused();
  await expect(page.getByRole("meter", { name: "통화 위험도" })).toHaveAttribute("aria-valuenow", "87");
  await expect(page.getByTestId("analysis-verdict")).toBeVisible();
  await expect(page.getByTestId("analysis-verdict")).toHaveAttribute("data-state", "danger");
  await page.getByRole("tab", { name: "AI 분석", exact: true }).click();
  await expect(page.getByTestId("analysis-reason")).toContainText("송금을 요구하고 있어요.");
  await expect(page.getByRole("tab", { name: "AI 분석", exact: true })).not.toHaveAttribute("data-unread");
  await expect(page.getByTestId("analysis-verdict")).toBeHidden();
  await publish(page, "warning", { eventSeq: 2, level: "WARN", score: 95, reason: "새 위험 정황", evidenceSeqs: [] });
  await expect(page.getByTestId("analysis-reason")).toContainText("새 위험 정황");
  await expect(banner).toHaveCount(0);
});

test("risk and result screens fit the viewport without a page or stage scrollbar", async ({ page }) => {
  await join(page, "나");
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  await publish(page, "utterance", { eventSeq: 1, seq: 1, kind: "SPEECH", trackId: "participant-1", text: "실시간 대화 기록입니다." });
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [900, 600], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    for (const results of [false, true]) {
      if (results) await page.getByRole("tab", { name: "AI 분석", exact: true }).click();
      await expect(page.getByRole("heading", { name: "ScamShield", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("button", { name: "통화 나가기", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("switch", { name: "실시간 보호", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(results ? page.getByTestId("transcript") : page.getByTestId("risk-timeline")).toBeInViewport({ ratio: 1 });
      if (!results) await expect(page.getByTestId("analysis-verdict")).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => {
        const stage = document.querySelector(".meeting-stage")!;
        return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
          stageOverflow: stage.scrollHeight - stage.clientHeight };
      })).toEqual({ width, height, stageOverflow: 0 });
      await page.screenshot({ path: `test-results/live-${results ? "results" : "risk"}-${width}.png` });
      if (results) await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
    }
  }
});

test("protection switch stops and restarts analysis while capture remains live", async ({ page, context }) => {
  let score: number | null = null;
  await context.route("**/api/analysis/calls/live-analysis", (route) => route.fulfill({ json: { current_score: score, analyzed_to: 0 } }));
  await join(page, "나");
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  const verdict = page.getByTestId("analysis-verdict");
  await expect(verdict).toHaveAttribute("data-state", "pending");
  await expect(verdict).not.toContainText("안전해요");
  const toggle = page.getByRole("switch", { name: "실시간 보호", exact: true });
  expect(await toggle.evaluate((element) => !!element.closest(".meeting-toolbar"))).toBe(true);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(verdict).toContainText("분석이 꺼져 있어요");
  expect(await page.evaluate(() => (window as any).__testAnalysisEvents === null)).toBe(true);
  expect(await page.evaluate(() => [(window as any).__testCapture, (window as any).__testVideoCapture]
    .every((stream) => stream.getTracks().every((track: MediaStreamTrack) => track.readyState === "live")))).toBe(true);
  await page.getByRole("tab", { name: "AI 분석", exact: true }).click();
  await expect(page.locator("#analysis-findings")).toContainText("실시간 보호를 켜면 분석 결과가 표시됩니다.");
  await expect(page.locator(".transcript-empty svg")).toHaveCount(0);
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  score = 12;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(verdict).toHaveAttribute("data-state", "safe");
  await page.evaluate(() => (window as any).__testAnalysisEvents.onerror());
  await expect(verdict).toHaveAttribute("data-state", "pending");
  await expect(verdict).toContainText("분석 연결 확인 중");
  await page.evaluate(() => (window as any).__testAnalysisEvents.onopen());
  await expect(verdict).toHaveAttribute("data-state", "safe");
  await page.getByRole("tab", { name: "audio-test 회의실", exact: true }).click();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => (window as any).__testAnalysisEvents === null)).toBe(true);
  await expect(page.getByRole("button", { name: "카메라 끄기", exact: true })).toBeVisible();
});

test("verdict ring rotates and wave amplitude changes while text stays still", async ({ page }) => {
  await join(page, "나");
  await page.getByRole("tab", { name: "실시간 위험도", exact: true }).click();
  for (const selector of [".verdict-ring-fill", ".verdict-wave path"]) {
    expect(await page.locator(selector).first().evaluate((element) => {
      const animation = element.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const first = getComputedStyle(element).transform;
      animation.currentTime = 1250;
      const second = getComputedStyle(element).transform;
      animation.play();
      return first !== second;
    })).toBe(true);
  }
  await expect(page.locator(".verdict-copy")).toHaveCSS("transform", "none");
  await expect(page.locator(".verdict-copy")).not.toContainText("현재 통화는");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".verdict-ring-fill")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".verdict-wave path").first()).toHaveCSS("animation-name", "none");
});

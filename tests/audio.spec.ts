import { test, expect, type Page } from "@playwright/test";
import { setup, join } from "./helpers/call";

async function openSound(page: Page) {
  await page.locator("summary[aria-label='사운드 설정']").click();
  await expect(page.getByRole("heading", { name: "사운드 설정" })).toBeVisible();
}

async function rms(page: Page, remote = false, sampleRate = 48000) {
  return page.evaluate(async ({ remote, sampleRate }) => {
    const client = (window as any).__call;
    const track = remote
      ? Object.values(client.connections).flatMap((pc: any) => pc.getReceivers()).find((r: any) => r.track.kind === "audio").track
      : client.micStream.getAudioTracks()[0];
    const context = new AudioContext({ sampleRate });
    await context.resume();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    await new Promise((resolve) => setTimeout(resolve, 400));
    let result = 0;
    for (let frame = 0; frame < 3; frame++) {
      analyser.getFloatTimeDomainData(samples);
      result = Math.max(result, Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length));
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    source.disconnect();
    await context.close();
    return result;
  }, { remote, sampleRate });
}

test.beforeEach(async ({ context }) => setup(context));

test("microphone gain reaches WebRTC and analysis; mute and hangup release capture", async ({ page, context }) => {
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  await expect(page.getByTestId("status")).toHaveText("통화 중");
  await openSound(page);
  let baseline = 0;
  await expect.poll(async () => {
    baseline = await rms(page);
    return baseline;
  }).toBeGreaterThan(0.03);
  await expect.poll(() => rms(other, true)).toBeGreaterThan(0.02);
  await page.getByRole("slider", { name: "내 마이크", exact: true }).fill("50");
  expect(await rms(page)).toBeCloseTo(baseline * 0.5, 2);
  // PCM 업로더와 같은 16kHz 컨텍스트에서도 조절된 음성이 읽혀야 한다.
  expect(await rms(page, false, 16000)).toBeCloseTo(baseline * 0.5, 2);
  await expect.poll(() => rms(other, true)).toBeLessThan(baseline * 0.7);
  await page.getByRole("slider", { name: "내 마이크", exact: true }).fill("200");
  expect(await rms(page)).toBeCloseTo(baseline * 2, 2);
  await expect.poll(() => rms(other, true)).toBeGreaterThan(baseline * 1.5);
  await page.getByRole("button", { name: "내 마이크 음소거", exact: true }).click();
  expect(await rms(page)).toBeLessThan(0.001);
  expect(await page.evaluate(() => (window as any).__testCapture.getAudioTracks()[0].enabled)).toBe(false);
  await page.getByRole("slider", { name: "내 마이크", exact: true }).fill("75");
  expect(await rms(page)).toBeLessThan(0.001);
  await page.getByRole("button", { name: "내 마이크 음소거 해제", exact: true }).click();
  expect(await rms(page)).toBeCloseTo(baseline * 0.75, 2);
  expect(await page.evaluate(() => {
    const client = (window as any).__call;
    (window as any).__testOutput = client.micStream;
    return Object.values(client.connections).every((pc: any) => pc.getSenders().some((s: any) => s.track === client.micStream.getAudioTracks()[0]));
  })).toBe(true);
  await page.getByRole("button", { name: "통화 나가기" }).click();
  expect(await page.evaluate(() => [(window as any).__testCapture, (window as any).__testOutput].every((stream) => stream.getTracks().every((t: MediaStreamTrack) => t.readyState === "ended")))).toBe(true);
});

test("participant listening settings are independent and preserve audio for analysis", async ({ page, context }) => {
  await join(page, "나");
  const second = await context.newPage();
  await join(second, "참가자 A");
  const third = await context.newPage();
  await join(third, "참가자 B");
  await expect(page.locator("audio")).toHaveCount(2);
  await expect(page.getByTestId("status")).toHaveText("통화 중");
  await openSound(page);
  await expect(page.getByRole("slider", { name: "통화 전체 듣기", exact: true })).toHaveCount(0);
  await page.getByRole("slider", { name: "참가자 A", exact: true }).fill("40");
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.map((a) => a.volume))).toEqual([0.4, 1]);
  await page.getByRole("button", { name: "참가자 A 음소거", exact: true }).click();
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.map((a) => a.muted))).toEqual([true, false]);
  await page.getByRole("button", { name: "참가자 B 음소거", exact: true }).click();
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.map((a) => a.muted))).toEqual([true, true]);
  await expect.poll(() => rms(page, true, 16000)).toBeGreaterThan(0.02);
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.every((a) => (a.srcObject as MediaStream).getAudioTracks().every((t) => t.enabled)))).toBe(true);
  await page.getByRole("button", { name: "참가자 B 음소거 해제", exact: true }).click();
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.map((a) => a.muted))).toEqual([true, false]);
  await page.getByRole("button", { name: "참가자 A 음소거 해제", exact: true }).click();
  expect(await page.locator("audio").evaluateAll((elements: HTMLAudioElement[]) => elements.map((a) => a.volume))).toEqual([0.4, 1]);
  await page.screenshot({ path: "test-results/sound-desktop.png", fullPage: true });
  await second.getByRole("button", { name: "통화 나가기" }).click();
  await expect(page.getByRole("slider", { name: "참가자 A", exact: true })).toHaveCount(0);
  await expect(page.locator("audio")).toHaveCount(1);
  await third.getByRole("button", { name: "통화 나가기" }).click();
  await expect(page.locator(".sound-peer-head")).toHaveText("참가자별 사운드0명");
});

test("saved settings survive a new call and fit on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await join(page, "모바일 참가자");
  await openSound(page);
  await page.getByRole("slider", { name: "내 마이크", exact: true }).fill("125");
  await expect(page.locator(".sound-note, .sound-muted-note")).toHaveCount(0);
  const bounds = await page.getByRole("region", { name: "사운드 설정" }).boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "통화 나가기" }).click();
  await page.reload();
  await page.getByRole("button", { name: "통화 시작", exact: true }).click();
  await openSound(page);
  await expect(page.getByRole("slider", { name: "내 마이크", exact: true })).toHaveValue("125");
  // 이전 버전의 전체 듣기 설정이 남아 있어도 UI와 재생에 사용하지 않는다.
  await expect(page.getByRole("slider")).toHaveCount(1);
  await page.screenshot({ path: "test-results/sound-mobile.png", fullPage: true });
  await page.getByRole("slider", { name: "내 마이크", exact: true }).press("Escape");
  await expect(page.getByRole("heading", { name: "사운드 설정" })).not.toBeVisible();
  await openSound(page);
  await page.getByRole("heading", { name: "회의룸: audio-test" }).click();
  await expect(page.getByRole("heading", { name: "사운드 설정" })).not.toBeVisible();
});

test("unusable saved values fall back or clamp safely", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("scamshield.sound.v1"))).not.toBeNull();
  await page.evaluate(() => localStorage.setItem("scamshield.sound.v1", JSON.stringify({ microphoneVolume: 500, outputVolume: -2, outputMuted: "false" })));
  await join(page, "설정 확인");
  await openSound(page);
  await expect(page.getByRole("slider", { name: "내 마이크", exact: true })).toHaveValue("200");
  await expect(page.getByRole("slider")).toHaveCount(1);
  await page.getByRole("button", { name: "통화 나가기" }).click();
  await page.evaluate(() => localStorage.setItem("scamshield.sound.v1", "invalid json"));
  await join(page, "설정 확인");
  await openSound(page);
  await expect(page.getByRole("slider", { name: "내 마이크", exact: true })).toHaveValue("100");
});

test("card context controls update peer playback and microphone, sharing toolbar settings", async ({ page, context }) => {
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  await expect(page.getByTestId("status")).toHaveText("통화 중");
  const peerCard = page.getByTestId("person-participant-2");
  await peerCard.click({ button: "right" });
  const peerMenu = page.getByRole("dialog", { name: "상대방 사운드 설정" });
  await expect(peerMenu).toBeVisible();
  await peerMenu.getByRole("slider", { name: "상대방", exact: true }).fill("35");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0.35);
  await peerMenu.getByRole("button", { name: "상대방 음소거", exact: true }).click();
  expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(true);
  await peerMenu.getByRole("slider").press("Escape");
  await expect(peerMenu).toHaveCount(0);
  await expect(peerCard).toBeFocused();
  await openSound(page);
  await expect(page.getByRole("slider", { name: "상대방", exact: true })).toHaveValue("35");
  await page.getByRole("button", { name: "상대방 음소거 해제", exact: true }).click();
  await page.getByRole("slider", { name: "상대방", exact: true }).fill("60");
  await peerCard.click({ button: "right" });
  await expect(peerMenu.getByRole("slider")).toHaveValue("60");
  await expect(page.getByRole("heading", { name: "사운드 설정", exact: true })).not.toBeVisible();
  await page.screenshot({ path: "test-results/card-sound-desktop.png", fullPage: true });
  await page.getByRole("heading", { name: "회의룸: audio-test" }).click();
  await expect(peerMenu).toHaveCount(0);

  const baseline = await rms(page);
  await page.getByTestId("person-participant-1").click({ button: "right" });
  const micMenu = page.getByRole("dialog", { name: "내 마이크 사운드 설정" });
  await micMenu.getByRole("slider").fill("150");
  expect(await rms(page)).toBeCloseTo(baseline * 1.5, 2);
  await micMenu.getByRole("button", { name: "내 마이크 음소거", exact: true }).click();
  expect(await rms(page)).toBeLessThan(0.001);
  await micMenu.getByRole("slider").press("Escape");
  await openSound(page);
  await expect(page.getByRole("slider", { name: "내 마이크", exact: true })).toHaveValue("150");
  await expect(page.getByRole("button", { name: "내 마이크 음소거 해제", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("card sound menu stays in the viewport, supports keyboard, and closes when a peer leaves", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 400 });
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  await expect(page.getByTestId("status")).toHaveText("통화 중");
  const card = page.getByTestId("person-participant-2");
  const cardBounds = await card.boundingBox();
  await card.click({ button: "right", position: { x: cardBounds!.width - 4, y: cardBounds!.height - 4 } });
  const menu = page.getByRole("dialog", { name: "상대방 사운드 설정" });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.y).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(367);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(392);
  await menu.getByRole("slider").press("Escape");
  await expect(card).toBeFocused();
  await card.press("Shift+F10");
  await expect(menu.getByRole("slider")).toBeFocused();
  await menu.getByRole("slider").press("ArrowLeft");
  await expect(menu.getByRole("slider")).toHaveValue("99");
  await other.getByRole("button", { name: "통화 나가기" }).click();
  await expect(menu).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

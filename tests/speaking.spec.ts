import { test, expect } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
});

test("speaking borders follow each participant's audio and stop on silence or mute", async ({ page, context }) => {
  await join(page, "나");
  const self = page.getByTestId("person-participant-1");
  await expect(self).toHaveAttribute("data-speaking", "true");
  await expect(self.locator(".trace, .pstate")).toHaveCount(0);
  expect(await self.evaluate((element) => getComputedStyle(element, "::after").borderTopWidth)).toBe("3px");
  const strength = () => self.evaluate((element) => Number((element as HTMLElement).style.getPropertyValue("--voice-level")));
  await expect.poll(strength).toBeGreaterThan(0.6);
  await page.evaluate(() => { (window as any).__testCaptureGain.gain.value = 0.04; });
  await expect.poll(strength).toBeLessThan(0.6);
  await expect(self).toHaveAttribute("data-speaking", "true");
  await page.evaluate(() => { (window as any).__testCaptureGain.gain.value = 0.2; });
  await expect.poll(strength).toBeGreaterThan(0.9);
  await page.evaluate(() => { (window as any).__testCaptureGain.gain.value = 0; });
  await expect(self).not.toHaveAttribute("data-speaking");
  await page.evaluate(() => { (window as any).__testCaptureGain.gain.value = 0.1; });
  await expect(self).toHaveAttribute("data-speaking", "true");

  const other = await context.newPage();
  await join(other, "상대방");
  const peer = page.getByTestId("person-participant-2");
  await expect(peer).toHaveAttribute("data-speaking", "true");
  await other.evaluate(() => { (window as any).__testCapture.getAudioTracks()[0].enabled = false; });
  await expect(peer).not.toHaveAttribute("data-speaking");
  await expect(self).toHaveAttribute("data-speaking", "true");
  await other.evaluate(() => { (window as any).__testCapture.getAudioTracks()[0].enabled = true; });
  await expect(peer).toHaveAttribute("data-speaking", "true");

  await page.getByRole("button", { name: "음소거", exact: true }).click();
  await expect(self).not.toHaveAttribute("data-speaking");
  await expect(self.locator(".pstate")).toHaveCount(0);
  await page.getByRole("button", { name: "음소거 해제", exact: true }).click();
  await expect(self).toHaveAttribute("data-speaking", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await self.evaluate((element) => getComputedStyle(element, "::after").transitionDuration)).toBe("0s");
  expect(await self.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1");
  await page.screenshot({ path: "test-results/speaking-border.png", fullPage: true });
});

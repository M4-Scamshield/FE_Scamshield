import { test, expect } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
});

test("invite copy shows temporary confirmation beside the icon and fits on mobile", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await join(page, "나");
  const invite = page.getByRole("button", { name: "초대 링크 복사", exact: true });
  const feedback = page.locator(".invite-feedback");
  await expect(feedback).not.toBeVisible();
  await invite.click();
  await expect(feedback).toHaveText("초대 링크가 복사되었습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://127.0.0.1:4174/?room=audio-test");
  const icon = await invite.boundingBox();
  const message = await feedback.boundingBox();
  expect(message!.x).toBeGreaterThan(icon!.x + icon!.width);
  await page.screenshot({ path: "test-results/invite-feedback.png", fullPage: true });
  await expect(feedback).not.toBeVisible();

  await page.setViewportSize({ width: 320, height: 812 });
  await invite.click();
  await expect(feedback).toBeVisible();
  const mobileMessage = await feedback.boundingBox();
  expect(mobileMessage!.x).toBeGreaterThanOrEqual(0);
  expect(mobileMessage!.x + mobileMessage!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/invite-feedback-mobile.png", fullPage: true });
});

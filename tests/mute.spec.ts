import { test, expect } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
});

test("a participant's mute is shown to everyone, including late joiners", async ({ page, context }) => {
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "상대방");
  const onOther = other.getByTestId("person-participant-1");
  await expect(onOther).toHaveAttribute("data-speaking", "true");
  const icon = onOther.locator(".pname svg");
  const micOn = await icon.innerHTML();

  await page.getByRole("button", { name: "음소거", exact: true }).click();
  await expect(onOther).toHaveAttribute("data-muted", "true");
  await expect(onOther).not.toHaveAttribute("data-speaking");
  expect(await icon.innerHTML()).not.toBe(micOn);

  const late = await context.newPage();
  await join(late, "늦은 사람");
  const onLate = late.getByTestId("person-participant-1");
  await expect(onLate).toHaveAttribute("data-muted", "true");
  await expect(late.getByTestId("person-participant-2")).not.toHaveAttribute("data-muted");
  await late.screenshot({ path: "test-results/peer-muted.png" });

  await page.getByRole("button", { name: "음소거 해제", exact: true }).click();
  for (const tile of [onOther, onLate]) {
    await expect(tile).not.toHaveAttribute("data-muted");
    await expect(tile).toHaveAttribute("data-speaking", "true");
  }
  expect(await icon.innerHTML()).toBe(micOn);
});

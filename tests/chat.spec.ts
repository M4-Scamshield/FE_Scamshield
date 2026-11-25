import { test, expect, type Page } from "@playwright/test";
import { setup, join } from "./helpers/call";

test.beforeEach(async ({ context }) => {
  await setup(context);
  // 채팅은 분석 서버와 독립적이며, 레이아웃 검증 중 네트워크 상태가 바뀌지 않게 한다.
  await context.route("**/api/analysis/calls", (route) => route.fulfill({ status: 503, json: {} }));
});

async function openChat(page: Page) {
  await page.getByRole("button", { name: "채팅 열기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "채팅 메시지 입력" })).toBeFocused();
}

async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "채팅 메시지 입력" }).fill(text);
  await expect(page.getByRole("button", { name: "전송", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "전송", exact: true }).click();
}

test("chat reaches every current peer, tracks unread messages, and clears on a new call", async ({ page, context }) => {
  await join(page, "나");
  await openChat(page);
  await expect(page.getByRole("button", { name: "전송", exact: true })).toBeDisabled();
  await expect(page.locator("#chat-input-hint")).toContainText("참가자가 들어오면");
  const other = await context.newPage();
  await join(other, "참가자 A");
  await send(page, "첫 메시지");
  await expect(page.locator(".chat-unread")).toHaveCount(0);
  await expect(other.locator(".chat-unread")).toHaveText("1");
  await openChat(other);
  await expect(other.getByRole("log", { name: "채팅 메시지" })).toContainText("첫 메시지");
  await expect(other.locator(".chat-unread")).toHaveCount(0);
  await send(other, "안녕하세요");
  await expect(page.getByRole("log")).toContainText("안녕하세요");

  const third = await context.newPage();
  await join(third, "참가자 B");
  await openChat(third);
  await expect(third.locator(".chat-message")).toHaveCount(0);
  await send(third, "세 명에게 전송");
  for (const target of [page, other, third]) await expect(target.getByRole("log")).toContainText("세 명에게 전송");
  const fourth = await context.newPage();
  await join(fourth, "참가자 C");
  await openChat(fourth);
  await send(page, "네 명에게 전송");
  for (const target of [page, other, third, fourth]) await expect(target.getByRole("log")).toContainText("네 명에게 전송");
  await other.getByRole("button", { name: "통화 나가기" }).click();
  await expect(page.getByTestId("person-participant-2")).toHaveCount(0);
  await send(page, "퇴장 후 전송");
  await expect(third.getByRole("log")).toContainText("퇴장 후 전송");
  await page.getByRole("button", { name: "통화 나가기" }).click();
  await page.getByRole("button", { name: "통화 시작", exact: true }).click();
  await openChat(page);
  await expect(page.locator(".chat-message")).toHaveCount(0);
});

test("chat leaves the safety panel unchanged, restores focus, and preserves drafts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await join(page, "나");
  const sidebar = page.locator("#call-safety-panel");
  const sidebarBefore = await sidebar.boundingBox();
  const transcriptBefore = await page.getByTestId("transcript").boundingBox();
  const stageBefore = await page.locator(".meeting-stage").boundingBox();
  await openChat(page);
  expect(await sidebar.boundingBox()).toEqual(sidebarBefore);
  expect(await page.getByTestId("transcript").boundingBox()).toEqual(transcriptBefore);
  const chat = await page.locator(".call-chat").boundingBox();
  expect(chat!.x + chat!.width).toBeLessThanOrEqual(sidebarBefore!.x);
  expect((await page.locator(".meeting-stage").boundingBox())!.height).toBeLessThan(stageBefore!.height);
  await page.getByRole("textbox", { name: "채팅 메시지 입력" }).fill("작성 중인 내용");
  await page.screenshot({ path: "test-results/chat-desktop.png", fullPage: true });
  await page.getByRole("textbox", { name: "채팅 메시지 입력" }).press("Escape");
  await expect(page.getByRole("button", { name: "채팅 열기", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "채팅 메시지 입력" })).toHaveCount(0);
  expect(await sidebar.boundingBox()).toEqual(sidebarBefore);
  await openChat(page);
  await expect(page.getByRole("textbox", { name: "채팅 메시지 입력" })).toHaveValue("작성 중인 내용");
  for (const width of [1024, 900, 801]) {
    await page.setViewportSize({ width, height: 844 });
    const panelBounds = await sidebar.boundingBox();
    const toolbarBounds = await page.locator(".meeting-toolbar").boundingBox();
    for (const control of await page.locator(".meeting-toolbar .round, .leave-button").all()) {
      const bounds = await control.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(toolbarBounds!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(panelBounds!.x);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "보호 패널 닫기" }).click();
  expect((await page.locator(".call-chat").boundingBox())!.width).toBe(1440);
  for (const width of [1024, 801, 800, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator(".call-chat").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "통화 나가기" })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/chat-mobile.png", fullPage: true });
});

test("composition, multiline text and length limits work without sending empty messages or HTML", async ({ page, context }) => {
  await join(page, "나");
  const other = await context.newPage();
  await join(other, "참가자 A");
  await openChat(page);
  await openChat(other);
  const input = page.getByRole("textbox", { name: "채팅 메시지 입력" });
  await input.fill("   ");
  await expect(page.getByRole("button", { name: "전송", exact: true })).toBeDisabled();
  await input.fill("한글 조합");
  await expect(page.locator("#chat-input-hint")).toContainText("Enter 전송");
  await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
  await expect(page.locator(".chat-message")).toHaveCount(0);
  await input.press("Shift+Enter");
  await input.pressSequentially("next line");
  await input.press("Enter");
  await expect(other.locator(".chat-message p")).toHaveText("한글 조합\nnext line", { useInnerText: true });
  await expect(input).toHaveValue("");
  await send(page, '<img src=x onerror="window.__chatExecuted=true">');
  await expect(other.locator(".chat-message img")).toHaveCount(0);
  await expect(other.getByRole("log")).toContainText("<img src=x");
  await send(page, "가".repeat(2000));
  await expect(other.locator(".chat-message p").last()).toHaveText("가".repeat(2000));
  expect(await input.getAttribute("maxlength")).toBe("2000");
});

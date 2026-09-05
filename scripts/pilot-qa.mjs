// Local-only QA: private pilot assets are imported through the same user-facing file input.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const out = "../Reports/Practice";
await mkdir(out, { recursive: true });
const bank = JSON.parse(
  await readFile("../Working/Practice/pilot/bank.json", "utf8"),
);
const browser = await chromium.launch();
async function open(topic) {
  const context = await browser.newContext({
      viewport: { width: 1366, height: 1024 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.PRACTICE_QA_URL || "http://127.0.0.1:5173/");
  await page
    .getByLabel("選擇題庫檔案")
    .setInputFiles("../Working/Practice/pilot/Pilot.ppsbank");
  await page.getByLabel(topic, { exact: true }).check();
  await page.screenshot({ path: `${out}/topics.png`, fullPage: true });
  await page.getByRole("button", { name: "開始練習", exact: true }).click();
  await page.getByLabel("題目", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "已儲存" }).waitFor();
  return { context, page, errors };
}
const mc = await open("Reproduction in Plants");
await mc.page.screenshot({ path: `${out}/mc.png`, fullPage: true });
const name = await mc.page.locator(".question-title").textContent();
const q = bank.questions.find((q) => q.title === name);
await mc.page
  .locator(".choice")
  .filter({ has: mc.page.locator("strong", { hasText: q.correctOptionId }) })
  .click();
await mc.page.getByRole("heading", { name: "✓ 答對", exact: true }).waitFor();
await mc.page.screenshot({ path: `${out}/mc-answer.png`, fullPage: true });
console.log("MC page errors", mc.errors);
await mc.context.close();
const sq = await open("Reproduction in Mammals");
await sq.page.screenshot({ path: `${out}/sq.png`, fullPage: true });
await sq.page.getByRole("button", { name: "查看答案", exact: true }).click();
await sq.page
  .getByRole("heading", { name: "合集參考答案", exact: true })
  .waitFor();
await sq.page.screenshot({ path: `${out}/sq-answer.png`, fullPage: true });
await sq.page.setViewportSize({ width: 1024, height: 1366 });
await sq.page.screenshot({ path: `${out}/sq-portrait.png`, fullPage: true });
console.log("SQ page errors", sq.errors);
await sq.context.close();
await browser.close();

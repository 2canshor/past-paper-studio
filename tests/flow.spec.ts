import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
  "base64",
);
function fixture(kind: "mc" | "sq", count = 1) {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const path = `assets/${sha(png)}.png`,
    asset = { path, alt: "示範題目" };
  const bank = {
    schemaVersion: 1,
    id: "test",
    version: `${kind}-${count}`,
    title: "測試題庫",
    topics: [{ id: "one", subject: "Biology", title: "測試 Topic" }],
    questions: Array.from({ length: count }, (_, i) => ({
      id: `q${i}`,
      kind,
      topicId: "one",
      secondaryTopicIds: [],
      title: `測試 ${kind} ${i}`,
      prompt: [asset],
      answer: [asset],
      answerLabel: "參考答案",
      reviewed: true,
      ...(kind === "mc"
        ? {
            correctOptionId: "B",
            options: ["A", "B", "C", "D"].map((id) => ({
              id,
              text: `選項 ${id}`,
            })),
          }
        : {}),
    })),
  };
  const files: Record<string, Uint8Array> = {
    "bank.json": strToU8(JSON.stringify(bank)),
    [path]: png,
  };
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "ppsbank",
      version: 1,
      files: Object.fromEntries(
        Object.entries(files).map(([p, b]) => [p, sha(b)]),
      ),
    }),
  );
  return {
    name: "test.ppsbank",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync(files)),
  };
}
async function setup(page: Page, kind: "mc" | "sq", count = 1, url = "/") {
  await page.goto(url);
  await page.getByLabel("選擇題庫檔案").setInputFiles(fixture(kind, count));
  await page.getByLabel("測試 Topic").check();
  await page.getByRole("button", { name: "開始練習", exact: true }).click();
  await expect(page.getByLabel("思考空間", { exact: true })).toBeVisible();
}
async function workspace(page: Page) {
  return page.evaluate(async () => {
    const d = await new Promise<IDBDatabase>((ok, no) => {
      const r = indexedDB.open("past-paper-studio", 1);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return new Promise<any>((ok, no) => {
      const r = d
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  });
}
test("MC wrong repeats with fresh attempt; correct exhausts and survives reopen", async ({
  page,
}) => {
  await setup(page, "mc");
  await page.getByRole("button", { name: "A 選項 A", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "答錯", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "B 選項 B", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "B 選項 B", exact: true }).click();
  await page.getByRole("button", { name: "下一題", exact: true }).click();
  await expect(page.getByText("呢一組已經全部完成。")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "選擇練習主題", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("測試 Topic")).toBeChecked();
  expect((await workspace(page)).session.phase).toBe("complete");
});

test('installing an update bypasses stale HTTP-cached HTML',async({page})=>{
 let old=true;
 const server=createServer(async(req,res)=>{const pathname=new URL(req.url!,'http://localhost').pathname;const path=pathname==='/'?'index.html':pathname.slice(1);try{res.setHeader('Cache-Control','public, max-age=3600');res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webmanifest')?'application/manifest+json':'text/html');res.end(old&&path==='index.html'?'<title>Old version</title>Old page':await readFile('dist/'+path));}catch{res.statusCode=404;res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{await page.goto(origin+'/index.html');await expect(page).toHaveTitle('Old version');old=false;await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});await page.reload();await expect(page).toHaveTitle('Past Paper');await expect(page.getByRole('heading',{name:'加入第一份題庫',exact:true})).toBeVisible();await new Promise<void>(r=>server.close(()=>r()));await page.reload();await expect(page.getByRole('heading',{name:'加入第一份題庫',exact:true})).toBeVisible();}finally{server.close();}
});
test("SQ ink, undo, redo, reload, self-mark, and clean repeat", async ({
  page,
}) => {
  await setup(page, "sq");
  const canvas = page.getByLabel("答案", { exact: true });
  const b = await canvas.boundingBox();
  await page.mouse.move(b!.x + 80, b!.y + 80);
  await page.mouse.down();
  await page.mouse.move(b!.x + 170, b!.y + 130, { steps: 20 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].answer.strokes.length;
    })
    .toBe(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].answer.strokes.length;
    })
    .toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].answer.strokes.length;
    })
    .toBe(1);
  await page.reload();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].answer.strokes.length;
    })
    .toBe(1);
  await page.getByRole("button", { name: "查看答案", exact: true }).click();
  await page.getByRole("button", { name: "未滿分", exact: true }).click();
  const w = await workspace(page);
  expect(w.attempts[w.session.attemptId].answer.strokes).toHaveLength(0);
  expect(Object.values(w.attempts)).toHaveLength(2);
  await page.getByRole("button", { name: "查看答案", exact: true }).click();
  await page.getByRole("button", { name: "滿分", exact: true }).click();
  await expect(page.getByText("呢一組已經全部完成。")).toBeVisible();
});
test("offline shell reload retains active question and local assets", async ({
  page,
  context,
  browserName,
}) => {
  const server = createServer(async (req, res) => {
    const pathname=new URL(req.url!,'http://localhost').pathname;
    const path = pathname === "/" ? "index.html" : pathname.slice(1);
    try {
      const data = await readFile("dist/" + path);
      res.setHeader(
        "Content-Type",
        path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".webmanifest")
              ? "application/manifest+json"
              : "text/html",
      );
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    await setup(page, "mc", 1, origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "B 選項 B", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => !!navigator.serviceWorker.controller),
    ).toBe(true);
    // Shut down the actual origin. WebKit's setOffline instrumentation rejects
    // navigation before the Service Worker; an unavailable server tests real cache use.
    await new Promise<void>((r) => server.close(() => r()));
    if (browserName === "chromium") await context.setOffline(true);
    await page.evaluate(() => ((window as any).__beforeOfflineReload = true));
    await page.reload();
    expect(
      await page.evaluate(() => (window as any).__beforeOfflineReload),
    ).toBeUndefined();
    await expect(
      page.getByRole("button", { name: "B 選項 B", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "B 選項 B", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "✓ 答對", exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
  } finally {
    server.close();
  }
});
test("corrupt import leaves existing progress untouched", async ({ page }) => {
  await setup(page, "mc");
  const before = await workspace(page);
  await page.getByLabel("選擇題庫檔案").setInputFiles({
    name: "bad.ppsbank",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await workspace(page)).session).toEqual(before.session);
});
test("portrait and enlarged interface do not overflow horizontally", async ({
  page,
}) => {
  await setup(page, "sq");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "34px"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "查看答案", exact: true }),
  ).toBeVisible();
});

test("erasing is undoable and touch-only input does not draw", async ({
  page,
}) => {
  await setup(page, "sq");
  const canvas = page.getByLabel("思考空間", { exact: true });
  const b = await canvas.boundingBox();
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 80,
    pointerType: "touch",
    button: 0,
    clientX: b!.x + 100,
    clientY: b!.y + 100,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 80,
    pointerType: "touch",
    button: 0,
  });
  expect(
    (await workspace(page)).attempts[(await workspace(page)).session.attemptId]
      .thinking.strokes,
  ).toHaveLength(0);
  await page.mouse.move(b!.x + 60, b!.y + 100);
  await page.mouse.down();
  await page.mouse.move(b!.x + 190, b!.y + 100, { steps: 30 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes.length;
    })
    .toBe(1);
  await page.getByRole("button", { name: "擦膠", exact: true }).click();
  await page.mouse.click(b!.x + 120, b!.y + 100);
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes.length;
    })
    .toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes.length;
    })
    .toBe(1);
});

test("backup restores the actual current attempt and score", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", {
      value: () => false,
      configurable: true,
    }),
  );
  await setup(page, "mc");
  await page.getByRole("button", { name: "A 選項 A", exact: true }).click();
  const before = await workspace(page);
  await page.getByRole("button", { name: "更多選項", exact: true }).click();
  await page.getByRole("button", { name: "匯出備份…", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載備份", exact: true }).click();
  const downloaded = await downloadPromise;
  const path = await downloaded.path();
  await page.getByLabel("選擇題庫檔案").setInputFiles(fixture("sq")); // bank update cannot replace active session
  expect((await workspace(page)).session).toEqual(before.session);
  await page.getByLabel("選擇備份檔案").setInputFiles(path!);
  const confirmation = page.getByRole("dialog");
  await expect(
    confirmation.getByText(
      "這部裝置目前的題庫、草稿及練習進度，會被備份中的內容取代。此操作不會合併兩份資料。",
    ),
  ).toBeVisible();
  expect((await workspace(page)).session).toEqual(before.session);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  expect((await workspace(page)).session).toEqual(before.session);
  await page.getByLabel("選擇備份檔案").setInputFiles(path!);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "還原備份", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已還原" }),
  ).toBeVisible();
  const restored = await workspace(page);
  expect(restored.session).toEqual(before.session);
  expect(restored.attempts).toEqual(before.attempts);
});

test("data actions are distinct, grouped, dismissible and stay inside the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("選擇題庫檔案").setInputFiles(fixture("mc"));
  const trigger = page.getByRole("button", { name: "管理資料", exact: true });
  await trigger.click();
  const popover = page.locator("#practice-actions");
  await expect(popover).toBeVisible();
  await expect(
    popover
      .getByRole("group", { name: "題庫", exact: true })
      .getByRole("button", { name: "匯入題庫…", exact: true }),
  ).toBeVisible();
  await expect(
    popover
      .getByRole("group", { name: "備份", exact: true })
      .getByRole("button", { name: "匯出備份…", exact: true }),
  ).toBeVisible();
  await expect(
    popover.getByRole("button", { name: "還原備份…", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("heading", { name: "選擇練習主題", exact: true })
    .click();
  await expect(popover).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "34px"));
  await trigger.click();
  const bounds = (await popover.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const buttons = await popover.getByRole("button").all();
  for (const b of buttons) {
    const box = await b.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("failed system sharing offers one download fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: () => true,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: async () => {
        throw new Error("Sharing unavailable");
      },
      configurable: true,
    });
  });
  await setup(page, "mc");
  await page.getByRole("button", { name: "更多選項", exact: true }).click();
  await page.getByRole("button", { name: "匯出備份…", exact: true }).click();
  await page.getByRole("button", { name: "儲存或分享…", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下載備份", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "儲存或分享…", exact: true }),
  ).toHaveCount(0);
});

test("choosing a bank through restore cannot silently import it", async ({
  page,
}) => {
  await setup(page, "mc");
  const before = await workspace(page);
  await page.getByLabel("選擇備份檔案").setInputFiles(fixture("sq"));
  await expect(page.getByRole("alert")).toContainText("呢個唔係備份檔案");
  expect((await workspace(page)).session).toEqual(before.session);
});

test("lasso moves ink and Undo restores its position", async ({ page }) => {
  await setup(page, "sq");
  const canvas = page.getByLabel("思考空間", { exact: true }),
    b = (await canvas.boundingBox())!;
  async function line(points: number[][]) {
    await page.mouse.move(b.x + points[0][0], b.y + points[0][1]);
    await page.mouse.down();
    for (const p of points.slice(1))
      await page.mouse.move(b.x + p[0], b.y + p[1], { steps: 10 });
    await page.mouse.up();
  }
  await line([
    [80, 100],
    [140, 100],
  ]);
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes.length;
    })
    .toBe(1);
  const old = await workspace(page);
  const first =
    old.attempts[old.session.attemptId].thinking.strokes[0].points[0][0];
  await page.getByRole("button", { name: "選取", exact: true }).click();
  await line([
    [50, 70],
    [170, 70],
    [170, 130],
    [50, 130],
    [50, 70],
  ]);
  await line([
    [100, 100],
    [180, 170],
  ]);
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes[0].points[0][0];
    })
    .toBeGreaterThan(first + 50);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => {
      const w = await workspace(page);
      return w.attempts[w.session.attemptId].thinking.strokes[0].points[0][0];
    })
    .toBe(first);
});

import { unzip, zip, strToU8, strFromU8, type Zippable } from "fflate";
import type { Bank, Workspace, Asset, Ink } from "./types";
import { bankKey } from "./types";
export const hash = async (data: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const MAX = 512 * 1024 * 1024;
export function assetRefs(b: Bank): Asset[] {
  return b.questions.flatMap((q) => [
    ...q.prompt,
    ...q.answer,
    ...(q.options || []).flatMap((o) => (o.image ? [o.image] : [])),
  ]);
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function validateBank(v: unknown): asserts v is Bank {
  const b = v as Bank;
  assert(
    b &&
      b.schemaVersion === 1 &&
      typeof b.id === "string" &&
      typeof b.version === "string" &&
      typeof b.title === "string",
    "不支援嘅題庫格式。",
  );
  assert(
    Array.isArray(b.topics) &&
      Array.isArray(b.questions) &&
      b.questions.length > 0 &&
      b.questions.length <= 20000,
    "題庫數量不正確。",
  );
  const topics = new Set<string>(),
    ids = new Set<string>();
  for (const t of b.topics) {
    assert(
      t &&
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        typeof t.subject === "string" &&
        !topics.has(t.id),
      "Topics 重複或缺少資料。",
    );
    topics.add(t.id);
  }
  for (const q of b.questions) {
    assert(
      q &&
        typeof q.id === "string" &&
        !ids.has(q.id) &&
        q.reviewed === true &&
        topics.has(q.topicId) &&
        ["mc", "sq"].includes(q.kind) &&
        typeof q.title === "string" &&
        typeof q.answerLabel === "string",
      "題目身份或核對狀態有問題。",
    );
    ids.add(q.id);
    assert(
      Array.isArray(q.prompt) &&
        q.prompt.length &&
        Array.isArray(q.answer) &&
        q.answer.length,
      "題目或答案缺失。",
    );
    if (q.kind === "mc") {
      assert(
        q.options?.length === 4 &&
          q.options.map((o) => o.id).join("") === "ABCD" &&
          q.options.some((o) => o.id === q.correctOptionId),
        "MC 答案或選項不完整。",
      );
      for (const o of q.options)
        assert(
          (typeof o.text === "string" && o.text.length > 0) || o.image,
          "MC 選項內容缺失。",
        );
    }
  }
  for (const a of assetRefs(b))
    assert(
      a &&
        /^assets\/[a-f0-9]{64}\.(png|jpg)$/.test(a.path) &&
        typeof a.alt === "string",
      "題目圖片格式不正確。",
    );
}
function validateInk(v: Ink) {
  assert(
    v &&
      Array.isArray(v.strokes) &&
      Array.isArray(v.undo) &&
      Array.isArray(v.redo) &&
      Array.isArray(v.events) &&
      v.view &&
      [v.view.x, v.view.y, v.view.scale, v.height].every(Number.isFinite) &&
      v.view.scale >= 0.1 &&
      v.view.scale <= 8,
    "草稿格式不正確。",
  );
  for (const s of [...v.strokes, ...v.undo.flat(), ...v.redo.flat()]) {
    assert(
      typeof s.id === "string" &&
        typeof s.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(s.color) &&
        Number.isFinite(s.width) &&
        s.width > 0 &&
        s.width < 100 &&
        Array.isArray(s.points) &&
        s.points.length < 100000,
      "筆跡格式不正確。",
    );
    for (const p of s.points)
      assert(
        Array.isArray(p) &&
          p.length === 3 &&
          p.every(Number.isFinite) &&
          p[2] >= 0 &&
          p[2] <= 1,
        "筆跡座標不正確。",
      );
  }
}
export function validateWorkspace(w: Workspace, banks: Bank[]) {
  assert(
    w &&
      w.schemaVersion === 1 &&
      Number.isSafeInteger(w.revision) &&
      w.revision >= 0 &&
      w.attempts &&
      Array.isArray(w.selectedTopics) &&
      w.pen &&
      Number.isFinite(w.pen.width) &&
      w.pen.width > 0 &&
      w.pen.width < 100 &&
      /^#[0-9a-f]{6}$/i.test(w.pen.color),
    "備份格式不正確。",
  );
  const by = new Map(banks.map((b) => [bankKey(b), b]));
  assert(!w.bankKey || by.has(w.bankKey), "備份缺少目前題庫。");
  for (const [id, a] of Object.entries(w.attempts)) {
    assert(
      a.id === id &&
        by.get(a.bankKey)?.questions.some((q) => q.id === a.questionId),
      "草稿與題目不匹配。",
    );
    validateInk(a.question);
    validateInk(a.thinking);
    validateInk(a.answer);
  }
  const s = w.session;
  if (s) {
    const b = by.get(s.bankKey);
    assert(
      b &&
        Array.isArray(s.allIds) &&
        s.allIds.every((id) => b.questions.some((q) => q.id === id)) &&
        new Set(s.allIds).size === s.allIds.length,
      "備份題池不完整。",
    );
    assert(
      Array.isArray(s.remaining) &&
        Array.isArray(s.queue) &&
        Array.isArray(s.recent) &&
        s.remaining.every((id) => s.allIds.includes(id)) &&
        s.queue.every((id) => s.remaining.includes(id)) &&
        ["active", "complete"].includes(s.phase) &&
        Number.isInteger(s.seed),
      "備份題池狀態不正確。",
    );
    assert(new Set(s.remaining).size === s.remaining.length && new Set(s.queue).size === s.queue.length && s.recent.every(id=>s.allIds.includes(id)), '備份題池有重複或未知題目。');
    if (s.phase === "active")
      assert(
        s.currentId &&
          s.attemptId &&
          w.attempts[s.attemptId]?.questionId === s.currentId,
        "備份缺少目前作答。",
      );
    if (s.phase === "complete")
      assert(
        s.remaining.length === 0 && !s.currentId && !s.attemptId,
        "已完成題池狀態不正確。",
      );
  }
  if(w.lastGrade){
    const g=w.lastGrade;
    assert(g.before && g.before.id===g.attemptId && g.session?.attemptId===g.attemptId && g.session.currentId===g.before.questionId && by.has(g.before.bankKey), '撤銷紀錄與題目不匹配。');
    validateWorkspace({...w,session:g.session,attempts:{...w.attempts,[g.attemptId]:g.before},lastGrade:null},banks);
  }
}
export async function unpack(file: File) {
  assert(file.size <= MAX, "檔案太大，請分批匯入題庫。");
  const raw = new Uint8Array(await file.arrayBuffer());
  let total = 0,
    entries = 0;
  const files = await new Promise<Record<string, Uint8Array>>((ok, no) =>
    unzip(
      raw,
      {
        filter: (f) => {
          total += f.originalSize;
          entries++;
          if (total > MAX || entries > 50000) throw Error("解壓後資料太大。");
          return true;
        },
      },
      (e, d) => (e ? no(e) : ok(d)),
    ),
  );
  const m = JSON.parse(strFromU8(files["manifest.json"] || new Uint8Array()));
  assert(
    m.version === 1 &&
      ["ppsbank", "ppsbackup", "ppsreview"].includes(m.format) &&
      m.files &&
      typeof m.files === "object",
    "不支援嘅封裝格式。",
  );
  assert(
    Object.keys(files).length === Object.keys(m.files).length + 1,
    "封裝包含未列明內容。",
  );
  for (const [name, digest] of Object.entries(m.files)) {
    assert(
      !name.includes("..") && !name.startsWith("/") && files[name],
      "封裝檔案缺失。",
    );
    assert(
      (await hash(files[name])) === digest,
      "檔案 checksum 不符，未有更改原有資料。",
    );
  }
  const banks: Bank[] =
    m.format === "ppsbank"
      ? [JSON.parse(strFromU8(files["bank.json"]))]
      : JSON.parse(strFromU8(files["banks.json"]));
  banks.forEach(validateBank);
  assert(new Set(banks.map(bankKey)).size === banks.length, "題庫版本重複。");
  const assets = new Map<string, Blob>();
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith("assets/")) {
      assert(
        /^assets\/[a-f0-9]{64}\.(png|jpg)$/.test(path) &&
          path.slice(7, 71) === (await hash(data)),
        "圖片身份不符。",
      );
      const png = data[0] === 137 && data[1] === 80 && data[2] === 78;
      const jpg = data[0] === 255 && data[1] === 216;
      assert(
        (path.endsWith(".png") && png) || (path.endsWith(".jpg") && jpg),
        "圖片不是支援格式。",
      );
      assets.set(
        path,
        new Blob([new Uint8Array(data)], {
          type: png ? "image/png" : "image/jpeg",
        }),
      );
    }
  }
  for (const b of banks)
    for (const a of assetRefs(b))
      assert(assets.has(a.path), "缺少題目／答案圖片。");
  const workspace =
    m.format === "ppsbackup"
      ? (JSON.parse(strFromU8(files["workspace.json"])) as Workspace)
      : undefined;
  if (workspace) validateWorkspace(workspace, banks);
  return { format: m.format as string, banks, assets, workspace };
}
export async function pack(
  format: "ppsbackup" | "ppsreview",
  banks: Bank[],
  assets: Map<string, Blob>,
  record: unknown,
) {
  const files: Record<string, Uint8Array> = {
    "banks.json": strToU8(JSON.stringify(banks)),
    [format === "ppsbackup" ? "workspace.json" : "review.json"]: strToU8(
      JSON.stringify(record),
    ),
  };
  for (const [path, blob] of assets)
    files[path] = new Uint8Array(await blob.arrayBuffer());
  const checks: Record<string, string> = {};
  for (const [p, b] of Object.entries(files)) checks[p] = await hash(b);
  files["manifest.json"] = strToU8(
    JSON.stringify({ format, version: 1, files: checks }),
  );
  const zipped = await new Promise<Uint8Array>((ok, no) =>
    zip(files as Zippable, { level: 1 }, (e, d) => (e ? no(e) : ok(d))),
  );
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}
export function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

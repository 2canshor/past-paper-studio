import { emptyWorkspace, type Workspace, type Bank, bankKey } from "./types";
let dbPromise: Promise<IDBDatabase> | null = null;
interface StoredAsset {
  bytes: ArrayBuffer;
  type: string;
}
async function encodeAssets(assets: Map<string, Blob>) {
  return Promise.all(
    [...assets].map(
      async ([path, blob]) =>
        [path, { bytes: await blob.arrayBuffer(), type: blob.type }] as const,
    ),
  );
}
function decodeAsset(value: StoredAsset | Blob): Blob {
  return value instanceof Blob
    ? value
    : new Blob([value.bytes], { type: value.type });
}
export function database() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open("past-paper-studio", 1);
      r.onupgradeneeded = () => {
        ["workspace", "banks", "assets"].forEach((name) =>
          r.result.createObjectStore(name),
        );
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbPromise;
}
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, no) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
const done = (t: IDBTransaction) =>
  new Promise<void>((ok, no) => {
    t.oncomplete = () => ok();
    t.onabort = () => no(t.error || Error("保存被中止。"));
    t.onerror = (event) =>
      no(
        (event.target as IDBRequest)?.error ||
          t.error ||
          Error("本地資料保存失敗。"),
      );
  });
export async function getWorkspace() {
  const d = await database();
  return (
    (await req<Workspace | undefined>(
      d.transaction("workspace").objectStore("workspace").get("current"),
    )) || emptyWorkspace()
  );
}
export async function getBank(key: string) {
  const d = await database();
  return req<Bank | undefined>(
    d.transaction("banks").objectStore("banks").get(key),
  );
}
export async function getAsset(path: string) {
  const d = await database();
  const stored = await req<StoredAsset | Blob | undefined>(
    d.transaction("assets").objectStore("assets").get(path),
  );
  return stored ? decodeAsset(stored) : undefined;
}
export async function commit(w: Workspace, expected: number) {
  const d = await database();
  const t = d.transaction("workspace", "readwrite"),
    finished = done(t),
    s = t.objectStore("workspace");
  const current = await req<Workspace | undefined>(s.get("current"));
  if ((current?.revision || 0) !== expected) {
    t.abort();
    await finished.catch(() => {});
    throw Error("另一個視窗已更新進度。請只保留一個練習視窗，再重新開啟。");
  }
  const next = { ...w, revision: expected + 1 };
  s.put(next, "current");
  await finished;
  return next;
}
export async function installBank(bank: Bank, assets: Map<string, Blob>) {
  // ArrayBuffer avoids WebKit Blob staging failures; finish conversion before opening the transaction.
  const encoded = await encodeAssets(assets);
  const d = await database();
  const t = d.transaction(["banks", "assets"], "readwrite"),
    finished = done(t);
  const key = bankKey(bank);
  const previous = await req<Bank | undefined>(t.objectStore("banks").get(key));
  if (previous && JSON.stringify(previous) !== JSON.stringify(bank)) {
    t.abort();
    await finished.catch(() => {});
    throw Error("相同題庫版本包含不同內容。請由製作者更新版本。");
  }
  t.objectStore("banks").put(bank, key);
  encoded.forEach(([path, value]) => t.objectStore("assets").put(value, path));
  await finished;
  return key;
}
export async function snapshot() {
  const d = await database();
  const t = d.transaction(["banks", "assets", "workspace"]),
    finished = done(t);
  const [banks, keys, values, work] = await Promise.all([
    req<Bank[]>(t.objectStore("banks").getAll()),
    req<IDBValidKey[]>(t.objectStore("assets").getAllKeys()),
    req<(StoredAsset | Blob)[]>(t.objectStore("assets").getAll()),
    req<Workspace | undefined>(t.objectStore("workspace").get("current")),
  ]);
  await finished;
  return {
    banks,
    assets: new Map(keys.map((k, i) => [String(k), decodeAsset(values[i])])),
    workspace: work || emptyWorkspace(),
  };
}
export async function restore(
  data: { banks: Bank[]; assets: Map<string, Blob>; workspace: Workspace },
  expected: number,
) {
  const encoded = await encodeAssets(data.assets);
  const d = await database();
  const t = d.transaction(["banks", "assets", "workspace"], "readwrite"),
    finished = done(t);
  const current = await req<Workspace | undefined>(
    t.objectStore("workspace").get("current"),
  );
  if ((current?.revision || 0) !== expected) {
    t.abort();
    await finished.catch(() => {});
    throw Error("進度已改變，請重新備份後再還原。");
  }
  ["banks", "assets", "workspace"].forEach((n) => t.objectStore(n).clear());
  data.banks.forEach((b) => t.objectStore("banks").put(b, bankKey(b)));
  encoded.forEach(([path, value]) => t.objectStore("assets").put(value, path));
  const w = { ...data.workspace, revision: expected + 1 };
  t.objectStore("workspace").put(w, "current");
  await finished;
  return w;
}

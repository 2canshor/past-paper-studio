import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  getWorkspace,
  commit,
  installBank,
  getBank,
  snapshot,
  restore,
} from "./db";
import { emptyWorkspace, bankKey } from "./types";
import { bank } from "../tests/bank-fixture";
import { pack, unpack, hash, validateBank, validateWorkspace } from "./archive";
import { zipSync, strToU8 } from "fflate";
describe("durable data and packages", () => {
  it("rejects stale writes instead of overwriting another window", async () => {
    const w = await getWorkspace();
    const next = await commit({ ...w, selectedTopics: ["a"] }, w.revision);
    await expect(
      commit({ ...w, selectedTopics: ["b"] }, w.revision),
    ).rejects.toThrow("另一個視窗");
    expect((await getWorkspace()).selectedTopics).toEqual(["a"]);
    expect(next.revision).toBe(w.revision + 1);
  });
  it("bank revisions are immutable", async () => {
    await installBank(bank, new Map());
    await expect(
      installBank({ ...bank, title: "changed" }, new Map()),
    ).rejects.toThrow("相同題庫版本");
    expect((await getBank(bankKey(bank)))?.title).toBe("Test");
  });
  it("validates MC key instead of accepting an incomplete key", () => {
    expect(() =>
      validateBank({
        ...bank,
        questions: [{ ...bank.questions[0], correctOptionId: "E" }],
      }),
    ).toThrow("MC");
  });
  it("detects checksum damage before install", async () => {
    const files = {
      "bank.json": strToU8(JSON.stringify(bank)),
      "manifest.json": strToU8(
        JSON.stringify({
          format: "ppsbank",
          version: 1,
          files: { "bank.json": "bad" },
        }),
      ),
    };
    await expect(
      unpack(new File([new Uint8Array(zipSync(files))], "bad.ppsbank")),
    ).rejects.toThrow("checksum");
  });
  it("round-trips complete backup including private assets", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const path = `assets/${await hash(bytes)}.png`;
    const b = {
      ...bank,
      questions: bank.questions.map((q) => ({
        ...q,
        prompt: [{ path, alt: "q" }],
        answer: [{ path, alt: "a" }],
      })),
    };
    const w = { ...emptyWorkspace(), bankKey: bankKey(b) };
    const blob = await pack(
      "ppsbackup",
      [b],
      new Map([[path, new Blob([bytes])]]),
      w,
    );
    const loaded = await unpack(new File([blob], "x.ppsbackup"));
    expect(loaded.workspace).toEqual(w);
    expect(loaded.assets.size).toBe(1);
    const old = await getWorkspace();
    await restore(
      {
        banks: loaded.banks,
        assets: loaded.assets,
        workspace: loaded.workspace!,
      },
      old.revision,
    );
    expect((await snapshot()).assets.size).toBe(1);
  });
  it("rejects a backup with an orphan current attempt", () => {
    const w = {
      ...emptyWorkspace(),
      bankKey: bankKey(bank),
      session: {
        id: "s",
        bankKey: bankKey(bank),
        selectedTopics: ["a"],
        allIds: ["mc0"],
        remaining: ["mc0"],
        queue: [],
        recent: [],
        seed: 1,
        currentId: "mc0",
        attemptId: "missing",
        phase: "active" as const,
      },
    };
    expect(() => validateWorkspace(w, [bank])).toThrow("目前作答");
  });
});

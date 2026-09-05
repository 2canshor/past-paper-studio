import { describe, it, expect } from "vitest";
import { emptyWorkspace, type Bank } from "./types";
import {
  start,
  selectMC,
  nextMC,
  markSQ,
  reveal,
  undoGrade,
  order,
} from "./engine";
import { bank } from "../tests/bank-fixture";
describe("practice lifecycle", () => {
  it("freezes only selected topics", () => {
    const w = start(emptyWorkspace(), bank, ["b"], 42);
    expect(w.session!.allIds.sort()).toEqual(["mc2", "mc3"]);
    expect(w.session!.selectedTopics).toEqual(["b"]);
  });
  it("does not start a second session over unfinished work", () => {
    const w = start(emptyWorkspace(), bank, ["b"], 42);
    expect(() => start(w, bank, ["a"])).toThrow();
  });
  it("correct MC exits pool and resists double submission", () => {
    let w = start(emptyWorkspace(), bank, ["b"], 1);
    const id = w.session!.currentId;
    w = selectMC(w, bank, "B");
    expect(w.session!.remaining).not.toContain(id);
    expect(() => selectMC(w, bank, "A")).toThrow();
    expect(w.attempts[w.session!.attemptId!].passed).toBe(true);
  });
  it("failed MC repeats only after others in pass, with clean paper", () => {
    let w = start(emptyWorkspace(), bank, ["b"], 1);
    const id = w.session!.currentId,
      old = w.session!.attemptId!;
    w.attempts[old].thinking.strokes = [
      { id: "ink", points: [[1, 1, 0.5]], width: 1, color: "#000000", at: 1 },
    ];
    w = selectMC(w, bank, "A");
    w = nextMC(w, bank);
    expect(w.session!.currentId).not.toBe(id);
    w = selectMC(w, bank, "B");
    w = nextMC(w, bank);
    expect(w.session!.currentId).toBe(id);
    expect(w.attempts[w.session!.attemptId!].thinking.strokes).toEqual([]);
    expect(w.attempts[old].thinking.strokes).toHaveLength(1);
  });
  it("one-card pool retries without deadlock and ends only on success", () => {
    const b = { ...bank, questions: [bank.questions[0]] };
    let w = start(emptyWorkspace(), b, ["a"], 4);
    for (let i = 0; i < 4; i++) {
      w = selectMC(w, b, "A");
      w = nextMC(w, b);
      expect(w.session!.phase).toBe("active");
    }
    w = selectMC(w, b, "B");
    w = nextMC(w, b);
    expect(w.session!.phase).toBe("complete");
    expect(w.session!.remaining).toEqual([]);
    expect(w.selectedTopics).toEqual(["a"]);
  });
  it("SQ requires reveal and follows self-mark rather than ink", () => {
    const b = { ...bank, questions: [bank.questions[4]] };
    let w = start(emptyWorkspace(), b, ["a"], 2);
    expect(() => markSQ(w, b, true)).toThrow();
    w = markSQ(reveal(w), b, false);
    expect(w.session!.phase).toBe("active");
    w = markSQ(reveal(w), b, true);
    expect(w.session!.phase).toBe("complete");
  });
  it("undo restores removed question and original attempt", () => {
    let w = start(emptyWorkspace(), bank, ["b"], 4);
    const s = structuredClone(w.session),
      id = w.session!.attemptId!;
    w = nextMC(selectMC(w, bank, "B"), bank);
    w = undoGrade(w);
    expect(w.session).toEqual(s);
    expect(w.attempts[id].passed).toBeUndefined();
    expect(w.lastGrade).toBeNull();
  });
  it("shuffle is reproducible and never drops or duplicates IDs", () => {
    const ids = bank.questions.map((q) => q.id);
    for (let seed = 0; seed < 100; seed++) {
      const a = order(ids, ["mc0", "sq"], bank.questions, seed);
      expect(a).toEqual(order(ids, ["mc0", "sq"], bank.questions, seed));
      expect([...a].sort()).toEqual([...ids].sort());
      expect(a[0]).not.toBe("sq");
    }
  });
  it("selected bank updates do not alter the frozen session pool", () => {
    const w = start(emptyWorkspace(), bank, ["b"], 1);
    expect(w.session!.allIds).toHaveLength(2);
    bank.questions.push({ ...bank.questions[0], id: "new", topicId: "b" });
    expect(w.session!.allIds).toHaveLength(2);
    bank.questions.pop();
  });
});

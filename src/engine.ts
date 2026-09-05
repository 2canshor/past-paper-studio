import {
  bankKey,
  emptyInk,
  type Bank,
  type Workspace,
  type Session,
  type OptionId,
  type Question,
} from "./types";
const copy = <T>(x: T): T => structuredClone(x);
const uuid = () => crypto.randomUUID();
function rng(seed: number) {
  let v = seed >>> 0;
  return () => {
    v = (v + 0x6d2b79f5) >>> 0;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function order(
  ids: string[],
  recent: string[],
  questions: Question[],
  seed: number,
): string[] {
  const random = rng(seed),
    topics = new Map(questions.map((q) => [q.id, q.topicId]));
  let best = [...ids],
    score = Infinity;
  for (let c = 0; c < 16; c++) {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    let cost = 0,
      prev = recent.at(-1);
    a.forEach((id, i) => {
      const ago = recent.length - 1 - recent.lastIndexOf(id);
      if (recent.includes(id)) cost += 20 / (ago + 1) / (i + 1);
      if (id === prev) cost += 100;
      if (prev && topics.get(prev) === topics.get(id)) cost += 3 / (i + 1);
      prev = id;
    });
    if (cost < score) {
      score = cost;
      best = a;
    }
  }
  // Always avoid an immediate same-question repeat when an alternative exists.
  if (best.length > 1 && best[0] === recent.at(-1)) {
    const n = best.findIndex((id) => id !== best[0]);
    [best[0], best[n]] = [best[n], best[0]];
  }
  return best;
}
function enter(w: Workspace, bank: Bank) {
  const s = w.session!;
  if (!s.remaining.length) {
    s.phase = "complete";
    s.currentId = null;
    s.attemptId = null;
    return;
  }
  if (!s.queue.length) {
    s.seed = (s.seed + 1) >>> 0;
    s.queue = order(s.remaining, s.recent, bank.questions, s.seed);
  }
  const qid = s.queue.shift()!;
  s.currentId = qid;
  s.attemptId = uuid();
  w.attempts[s.attemptId] = {
    id: s.attemptId,
    questionId: qid,
    bankKey: s.bankKey,
    createdAt: Date.now(),
    question: emptyInk(),
    thinking: emptyInk(),
    answer: emptyInk(),
    revealed: false,
  };
}
export function start(
  work: Workspace,
  bank: Bank,
  selected: string[],
  seed = crypto.getRandomValues(new Uint32Array(1))[0],
) {
  if (work.session?.phase === "active") throw Error("目前仍有未完成練習。");
  const ids = bank.questions
    .filter((q) => selected.includes(q.topicId) && q.reviewed)
    .map((q) => q.id);
  if (!ids.length) throw Error("請選擇至少一個有題目嘅 Topic。");
  const w = copy(work);
  w.bankKey = bankKey(bank);
  w.selectedTopics = [...selected];
  w.lastGrade = null;
  w.session = {
    id: uuid(),
    bankKey: bankKey(bank),
    selectedTopics: [...selected],
    allIds: ids,
    remaining: [...ids],
    queue: order(ids, [], bank.questions, seed),
    recent: [],
    seed,
    currentId: null,
    attemptId: null,
    phase: "active",
  };
  enter(w, bank);
  return w;
}
function grade(w: Workspace, passed: boolean) {
  const s = w.session!,
    a = w.attempts[s.attemptId!];
  if (a.passed !== undefined) throw Error("呢題已提交。");
  w.lastGrade = { session: copy(s), attemptId: a.id, before: copy(a) };
  a.passed = passed;
  a.gradedAt = Date.now();
  a.revealed = true;
  if (passed) s.remaining = s.remaining.filter((id) => id !== a.questionId);
  s.recent = [...s.recent, a.questionId].slice(-32);
}
export function selectMC(work: Workspace, bank: Bank, option: OptionId) {
  const w = copy(work),
    s = w.session;
  if (!s || s.phase !== "active") throw Error("冇進行中練習。");
  const q = bank.questions.find((q) => q.id === s.currentId);
  if (q?.kind !== "mc" || !q.options?.some((o) => o.id === option))
    throw Error("選項不適用。");
  grade(w, option === q.correctOptionId);
  w.attempts[s.attemptId!].selected = option;
  return w;
}
export function reveal(work: Workspace) {
  const w = copy(work);
  if (!w.session?.attemptId) throw Error("冇進行中題目。");
  w.attempts[w.session.attemptId].revealed = true;
  return w;
}
export function markSQ(work: Workspace, bank: Bank, passed: boolean) {
  const w = copy(work),
    s = w.session;
  if (
    !s?.attemptId ||
    bank.questions.find((q) => q.id === s.currentId)?.kind !== "sq"
  )
    throw Error("唔係 SQ。");
  if (!w.attempts[s.attemptId].revealed) throw Error("請先查看參考答案。");
  grade(w, passed);
  enter(w, bank);
  return w;
}
export function nextMC(work: Workspace, bank: Bank) {
  const w = copy(work);
  if (
    !w.session?.attemptId ||
    w.attempts[w.session.attemptId].passed === undefined
  )
    throw Error("請先選答案。");
  enter(w, bank);
  return w;
}
export function undoGrade(work: Workspace) {
  const w = copy(work);
  if (!w.lastGrade) return w;
  const last = w.lastGrade;
  const current = w.session?.attemptId;
  if (current && current !== last.attemptId) {
    const a = w.attempts[current];
    if (
      a.thinking.strokes.length ||
      a.answer.strokes.length ||
      a.question.strokes.length
    )
      throw Error("下一題已有草稿，請先保留目前作答。");
    delete w.attempts[current];
  }
  w.session = last.session;
  w.attempts[last.attemptId] = last.before;
  w.lastGrade = null;
  return w;
}

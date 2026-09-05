export type Kind = "mc" | "sq";
export type OptionId = "A" | "B" | "C" | "D";
export interface Source {
  subject: string;
  pdfHash: string;
  page: number;
  box: number[];
  sourceFile?: string;
  sourcePage?: number;
}
export interface Asset {
  path: string;
  alt: string;
  source?: Source;
}
export interface Question {
  id: string;
  kind: Kind;
  topicId: string;
  secondaryTopicIds: string[];
  title: string;
  prompt: Asset[];
  answer: Asset[];
  answerLabel: string;
  reviewed: true;
  options?: { id: OptionId; text?: string; image?: Asset }[];
  correctOptionId?: OptionId;
}
export interface Bank {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  topics: { id: string; subject: string; title: string }[];
  questions: Question[];
  coverage?: {
    totalPages: number;
    reviewedQuestions: number;
    deferredPages: number;
    note: string;
  };
}
export type Point = [number, number, number];
export interface Stroke {
  id: string;
  points: Point[];
  width: number;
  color: string;
  at: number;
}
export interface View {
  x: number;
  y: number;
  scale: number;
}
export interface Ink {
  strokes: Stroke[];
  undo: Stroke[][];
  redo: Stroke[][];
  view: View;
  height: number;
  events: { at: number; action: string; strokeIds: string[] }[];
}
export interface Attempt {
  id: string;
  questionId: string;
  bankKey: string;
  createdAt: number;
  question: Ink;
  thinking: Ink;
  answer: Ink;
  revealed: boolean;
  selected?: OptionId;
  passed?: boolean;
  gradedAt?: number;
}
export interface Session {
  id: string;
  bankKey: string;
  selectedTopics: string[];
  allIds: string[];
  remaining: string[];
  queue: string[];
  recent: string[];
  seed: number;
  currentId: string | null;
  attemptId: string | null;
  phase: "active" | "complete";
}
export interface Workspace {
  schemaVersion: 1;
  revision: number;
  bankKey: string | null;
  selectedTopics: string[];
  session: Session | null;
  attempts: Record<string, Attempt>;
  lastGrade: { session: Session; attemptId: string; before: Attempt } | null;
  pen: { width: number; color: string };
}
export const bankKey = (bank: Bank) => `${bank.id}@${bank.version}`;
export const emptyInk = (): Ink => ({
  strokes: [],
  undo: [],
  redo: [],
  view: { x: 0, y: 0, scale: 1 },
  height: 760,
  events: [],
});
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1,
  revision: 0,
  bankKey: null,
  selectedTopics: [],
  session: null,
  attempts: {},
  lastGrade: null,
  pen: { width: 1.5, color: "#202124" },
});

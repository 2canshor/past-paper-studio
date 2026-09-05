import type { Bank } from "../src/types";
const image = { path: "assets/" + "0".repeat(64) + ".png", alt: "test" };
export const bank: Bank = {
  schemaVersion: 1,
  id: "test",
  version: "1",
  title: "Test",
  topics: [
    { id: "a", subject: "Biology", title: "A" },
    { id: "b", subject: "Chemistry", title: "B" },
  ],
  questions: [
    ...Array.from({ length: 4 }, (_, i) => ({
      id: "mc" + i,
      kind: "mc" as const,
      topicId: i < 2 ? "a" : "b",
      secondaryTopicIds: [],
      title: "MC " + i,
      prompt: [image],
      answer: [image],
      answerLabel: "test",
      reviewed: true as const,
      options: ("ABCD".split("") as ("A" | "B" | "C" | "D")[]).map((id) => ({
        id,
        text: id,
      })),
      correctOptionId: "B" as const,
    })),
    {
      id: "sq",
      kind: "sq",
      topicId: "a",
      secondaryTopicIds: [],
      title: "SQ",
      prompt: [image],
      answer: [image],
      answerLabel: "test",
      reviewed: true,
    },
  ],
};

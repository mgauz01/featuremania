import { expect, test } from "vitest";
import {
  applyGroups,
  deconstruct,
  dissolve,
  mergeGroup,
  rejoin,
  toParentCard,
} from "@/lib/live-grouping";
import type { KanbanIssue } from "@/components/KanbanBoard";

const alpha: KanbanIssue = {
  id: 1,
  title: "Login",
  score: 1,
  repo: "acme/app",
  number: 1,
  issueKey: "acme/app#1",
};
const beta: KanbanIssue = {
  id: 2,
  title: "Signup",
  score: 1,
  repo: "acme/app",
  number: 2,
  issueKey: "acme/app#2",
};

test("deconstruct hides selected tickets under a new parent", () => {
  const groups = deconstruct([], ["acme/app#1", "acme/app#2"], "Auth cleanup", "fm:group:test");
  expect(groups).toHaveLength(1);
  expect(applyGroups([alpha, beta], groups).map((issue) => issue.title)).toEqual(["Auth cleanup"]);
  expect(applyGroups([alpha, beta], groups)[0]?.kind).toBe("featuremania");
});

test("one ticket or an empty title does not create a group", () => {
  expect(deconstruct([], ["acme/app#1"], "Auth cleanup")).toEqual([]);
  expect(deconstruct([], ["acme/app#1", "acme/app#2"], "   ")).toEqual([]);
});

test("undo restores children to the top level", () => {
  const groups = deconstruct([], ["acme/app#1", "acme/app#2"], "Auth cleanup", "fm:group:test");
  const undone = dissolve(groups, "fm:group:test");
  expect(applyGroups([alpha, beta], undone).map((issue) => issue.title)).toEqual(["Login", "Signup"]);
});

test("rejoin drops missing children and empty parents", () => {
  const groups = deconstruct([], ["acme/app#1", "acme/app#2"], "Auth cleanup", "fm:group:test");
  const half = rejoin(groups, new Set(["acme/app#1"]));
  expect(half[0]?.childKeys).toEqual(["acme/app#1"]);
  expect(rejoin(groups, new Set())).toEqual([]);
});

test("merge group is a Featuremania card without a work index", () => {
  const groups = mergeGroup([], ["acme/app#1", "acme/app#2"], "Auth", "fm:group:merge");
  const card = toParentCard(groups[0]!);
  expect(card.groupMode).toBe("merge");
  expect(card.score).toBe(0);
});

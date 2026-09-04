import type { KanbanIssue } from "@/components/KanbanBoard";

export type GroupMode = "parent" | "merge";

export type LiveGroup = {
  id: string;
  title: string;
  childKeys: string[];
  mode: GroupMode;
};

export function newGroupId(): string {
  return `fm:group:${crypto.randomUUID()}`;
}

export function groupNumericId(groupId: string): number {
  let hash = 0;
  for (const char of groupId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return hash === 0 ? -1 : -Math.abs(hash);
}

export function asGroup(value: unknown): LiveGroup | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.startsWith("fm:group:")) {
    return null;
  }
  if (typeof record.title !== "string" || record.title.trim().length === 0) {
    return null;
  }
  if (!Array.isArray(record.childKeys) || !record.childKeys.every((key) => typeof key === "string")) {
    return null;
  }
  if (record.mode !== "parent" && record.mode !== "merge") {
    return null;
  }
  return {
    id: record.id,
    title: record.title.trim(),
    childKeys: record.childKeys,
    mode: record.mode,
  };
}

export function deconstruct(
  groups: LiveGroup[],
  childKeys: string[],
  title: string,
  id: string = newGroupId(),
): LiveGroup[] {
  const trimmed = title.trim();
  const unique = [...new Set(childKeys)].filter(Boolean);
  if (trimmed.length === 0 || unique.length < 2) {
    return groups;
  }
  return [...groups, { id, title: trimmed, childKeys: unique, mode: "parent" }];
}

export function mergeGroup(
  groups: LiveGroup[],
  childKeys: string[],
  title: string,
  id: string = newGroupId(),
): LiveGroup[] {
  const trimmed = title.trim();
  const unique = [...new Set(childKeys)].filter(Boolean);
  if (trimmed.length === 0 || unique.length < 2) {
    return groups;
  }
  return [...groups, { id, title: trimmed, childKeys: unique, mode: "merge" }];
}

export function dissolve(groups: LiveGroup[], groupId: string): LiveGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function rejoin(groups: LiveGroup[], presentKeys: Set<string>): LiveGroup[] {
  return groups
    .map((group) => ({
      ...group,
      childKeys: group.childKeys.filter((key) => presentKeys.has(key)),
    }))
    .filter((group) => group.childKeys.length > 0);
}

export function hiddenChildKeys(groups: LiveGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.childKeys));
}

export function toParentCard(group: LiveGroup): KanbanIssue {
  return {
    id: groupNumericId(group.id),
    title: group.title,
    score: 0,
    issueKey: group.id,
    kind: "featuremania",
    childKeys: group.childKeys,
    groupMode: group.mode,
    status: "backlog",
  };
}

export function applyGroups(issues: KanbanIssue[], groups: LiveGroup[]): KanbanIssue[] {
  const hidden = hiddenChildKeys(groups);
  const topLevel = issues.filter((issue) => !issue.issueKey || !hidden.has(issue.issueKey));
  return [...groups.map(toParentCard), ...topLevel];
}

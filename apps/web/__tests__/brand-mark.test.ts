import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const layout = readFileSync(resolve(__dirname, "../app/layout.tsx"), "utf8");

test("document title stays FeatureMania and the header lockup is gone", () => {
  expect(layout).toContain('title: "FeatureMania"');
  expect(layout).not.toMatch(/>\s*FeatureMania\s*</);
  expect(layout).not.toContain('src="/brand-vault.png"');
  expect(layout).not.toContain("app-brand");
});

test("icons keep distinct favicon and apple-touch paths", () => {
  expect(layout).toContain('url: "/favicon.png"');
  expect(layout).toContain('url: "/apple-touch-icon.png"');
});

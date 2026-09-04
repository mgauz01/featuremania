import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const layout = readFileSync(resolve(__dirname, "../app/layout.tsx"), "utf8");

test("header wordmark and title are FeatureMania", () => {
  expect(layout).toContain('title: "FeatureMania"');
  expect(layout).toMatch(/>\s*FeatureMania\s*</);
  expect(layout).not.toMatch(/>\s*Featuremania\s*</);
});

test("icons keep distinct favicon and apple-touch paths", () => {
  expect(layout).toContain('url: "/favicon.png"');
  expect(layout).toContain('src="/brand-vault.png"');
  expect(layout).toContain('url: "/apple-touch-icon.png"');
});

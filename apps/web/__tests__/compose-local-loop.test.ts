import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const compose = readFileSync(resolve(__dirname, "../../../docker-compose.yml"), "utf8");
const webDockerfile = readFileSync(resolve(__dirname, "../../../Dockerfile.web"), "utf8");
const rootDockerignore = readFileSync(resolve(__dirname, "../../../.dockerignore"), "utf8");

test("compose publishes a web service that hops to the API by Compose DNS", () => {
  expect(compose).toMatch(/^\s+web:/m);
  expect(compose).toContain("API_ORIGIN: http://api:8000");
  expect(compose).toContain("NEXTAUTH_URL: http://localhost:3000");
  expect(compose).toContain("3000:3000");
  expect(compose).toContain("8000:8000");
  expect(compose).toContain("--port 8000 --reload");
});

test("compose still forbids an Otari sidecar", () => {
  expect(compose).toContain("do not invent one");
});

test("web image binds Next to a non-loopback hostname", () => {
  expect(webDockerfile).toContain("--hostname");
  expect(webDockerfile).toContain("0.0.0.0");
  expect(webDockerfile).not.toMatch(/COPY\s+\.env/);
});

test("root dockerignore does not drop the web app from a repo-root build", () => {
  const lines = rootDockerignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  expect(lines).not.toContain("apps/web");
  expect(rootDockerignore).toContain(".env");
  expect(rootDockerignore).toContain("**/.env.local");
});

import { expect, test, vi } from "vitest";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { proxyLiveApi } from "@/lib/github-bff";
import { preflightBlocksPicker } from "@/lib/live-preflight";

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

test("preflightBlocksPicker is true when Otari is not ok", () => {
  expect(
    preflightBlocksPicker({
      ready: false,
      github: "ok",
      otari: "error",
      github_error: null,
      otari_error: "Otari is not configured or did not answer",
    }),
  ).toBe(true);
});

test("preflightBlocksPicker is false when ready", () => {
  expect(
    preflightBlocksPicker({
      ready: true,
      github: "ok",
      otari: "ok",
      github_error: null,
      otari_error: null,
    }),
  ).toBe(false);
});

test("proxyLiveApi returns 401 when the jwt has no access token", async () => {
  vi.mocked(getToken).mockResolvedValue(null);
  const req = new NextRequest("http://localhost:3000/api/live/preflight");
  const response = await proxyLiveApi(req, "/v1/preflight");
  expect(response.status).toBe(401);
});

test("proxyLiveApi returns JSON when getToken throws", async () => {
  vi.mocked(getToken).mockRejectedValue(new Error("decrypt"));
  const req = new NextRequest("http://localhost:3000/api/live/overlap", { method: "POST" });
  const response = await proxyLiveApi(req, "/v1/boards/overlap", { method: "POST", body: "{}" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    detail: "The API request failed. Try again.",
  });
});

test("proxyLiveApi returns 504 when the upstream fetch times out", async () => {
  vi.mocked(getToken).mockResolvedValue({ accessToken: "gho_test" } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const error = new Error("Headers Timeout Error");
      error.name = "HeadersTimeoutError";
      (error as Error & { code?: string }).code = "UND_ERR_HEADERS_TIMEOUT";
      throw error;
    }),
  );
  const req = new NextRequest("http://localhost:3000/api/live/load", { method: "POST" });
  const response = await proxyLiveApi(req, "/v1/boards/load", { method: "POST", body: "{}" });
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({
    detail: "Load timed out. Try fewer repositories.",
  });
});

test("proxyLiveApi returns JSON when the upstream body is not JSON", async () => {
  vi.mocked(getToken).mockResolvedValue({ accessToken: "gho_test" } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response("<!DOCTYPE html><html><body>oops</body></html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  const req = new NextRequest("http://localhost:3000/api/live/overlap", { method: "POST" });
  const response = await proxyLiveApi(req, "/v1/boards/overlap", { method: "POST", body: "{}" });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    detail: "The API returned an unexpected response. Try again.",
  });
});

test("proxyLiveApi returns JSON when the upstream fetch throws unexpectedly", async () => {
  vi.mocked(getToken).mockResolvedValue({ accessToken: "gho_test" } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("socket hang up");
    }),
  );
  const req = new NextRequest("http://localhost:3000/api/live/overlap", { method: "POST" });
  const response = await proxyLiveApi(req, "/v1/boards/overlap", { method: "POST", body: "{}" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    detail: "The API request failed. Try again.",
  });
});

test("proxyLiveApi returns 503 when the API is not listening", async () => {
  vi.mocked(getToken).mockResolvedValue({ accessToken: "gho_test" } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const error = new Error("fetch failed");
      (error as Error & { cause?: { code?: string } }).cause = { code: "ECONNREFUSED" };
      throw error;
    }),
  );
  const req = new NextRequest("http://localhost:3000/api/live/preflight");
  const response = await proxyLiveApi(req, "/v1/preflight");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "The API is not running on localhost:8000. Start FastAPI, then refresh.",
  });
});


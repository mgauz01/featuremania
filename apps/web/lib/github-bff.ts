import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const API_ORIGIN = process.env.API_ORIGIN || "http://localhost:8000";
const LOAD_TIMEOUT_MS = 180_000;

const API_DOWN_MESSAGE =
  "The API is not running on localhost:8000. Start FastAPI, then refresh.";

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    err.name === "HeadersTimeoutError" ||
    err.code === "UND_ERR_HEADERS_TIMEOUT" ||
    err.cause?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    err.cause?.name === "TimeoutError"
  );
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED";
}

export async function proxyLiveApi(
  req: NextRequest,
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<NextResponse> {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const accessToken =
      token && typeof token.accessToken === "string" ? token.accessToken : undefined;
    if (!accessToken) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const signal = init?.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
    const response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    try {
      return NextResponse.json(JSON.parse(text) as unknown, { status: response.status });
    } catch {
      return NextResponse.json(
        { detail: "The API returned an unexpected response. Try again." },
        { status: response.status >= 400 ? response.status : 502 },
      );
    }
  } catch (error) {
    if (isTimeoutError(error)) {
      return NextResponse.json(
        { detail: "Load timed out. Try fewer repositories." },
        { status: 504 },
      );
    }
    if (isConnectionError(error)) {
      return NextResponse.json({ error: API_DOWN_MESSAGE }, { status: 503 });
    }
    return NextResponse.json(
      { detail: "The API request failed. Try again." },
      { status: 503 },
    );
  }
}

export { LOAD_TIMEOUT_MS };

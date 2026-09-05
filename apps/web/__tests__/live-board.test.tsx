import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import LiveBoard from "@/components/LiveBoard";
import {
  LIVE_BOARD_SNAPSHOT_KEY,
  readLiveBoardSnapshot,
  writeLiveBoardSnapshot,
} from "@/lib/live-board-snapshot";

const sessionState = vi.hoisted(() => ({
  status: "authenticated" as "authenticated" | "unauthenticated" | "loading",
  userId: "gh-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data:
      sessionState.status === "authenticated"
        ? {
          user: {
            id: sessionState.userId,
            name: sessionState.name,
            email: sessionState.email,
          },
        }
        : null,
    status: sessionState.status,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionState.status = "authenticated";
  sessionState.userId = "gh-1";
  sessionState.name = "Ada Lovelace";
  sessionState.email = "ada@example.com";
  window.localStorage.clear();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function idleProgress(): Response {
  return jsonResponse({ status: "idle", current: 0, total: 0, detail: "" });
}

test("picker fieldset is height-capped and Load board stays outside it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  const picker = await screen.findByRole("group", { name: "Pick repositories" });
  const fold = document.querySelector(".live-board-picker-fold");
  expect(fold).not.toBeNull();
  expect(fold).toHaveAttribute("open");
  expect(within(picker).queryByRole("button", { name: "Load board" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Load board" })).toBeInTheDocument();

  const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
  expect(css).toMatch(/\.live-board-picker fieldset[\s\S]*?max-height:\s*min\(40vh,\s*18rem\)/);
  expect(css).toMatch(/\.live-board-picker fieldset[\s\S]*?overflow-y:\s*auto/);
  expect(css).toMatch(/\.live-board-picker fieldset[\s\S]*?flex-wrap:\s*wrap/);
  expect(css).toMatch(/\.app-workspace[\s\S]*?grid-template-columns:\s*13\.5rem minmax\(0,\s*1fr\)/);
  expect(css).not.toMatch(/h-screen/);
});


test("a GitHub preflight failure tells the user to sign in again", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: false,
          github: "error",
          otari: "ok",
          github_error: "GitHub is not reachable with this sign-in",
          otari_error: null,
        });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("GitHub is not reachable with this sign-in");
  expect(alert).toHaveTextContent("Sign out and sign in again");
});

test("hides the repo picker when preflight is not ready", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: false,
          github: "ok",
          otari: "error",
          github_error: null,
          otari_error: "Otari is not configured or did not answer",
        });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByRole("alert");
  expect(screen.getByText(/otari is not configured/i)).toBeInTheDocument();
  expect(screen.queryByText("Pick repositories")).not.toBeInTheDocument();
  expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
  expect(screen.queryByText("Fix login redirect")).not.toBeInTheDocument();
});

test("loads real issues after a successful pick and does not show sample titles", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["acme/app"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    if (url.includes("/api/live/load") && init?.method === "POST") {
      return jsonResponse({
        issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
  expect(screen.queryByText("Fix login redirect")).not.toBeInTheDocument();
});

test("shows an Otari error instead of sample cards when load fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      if (url.includes("/api/live/load") && init?.method === "POST") {
        return jsonResponse({ detail: "Otari is not configured or did not answer" }, 503);
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByRole("alert");
  expect(screen.getByText(/otari is not configured/i)).toBeInTheDocument();
  expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
});

test("a successful load still shows an Otari warning from the payload", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      if (url.includes("/api/live/load") && init?.method === "POST") {
        return jsonResponse({
          issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
          warning: "Otari failed on 1 of 1 issues. Otari gateway returned HTTP 403 Forbidden.",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  expect(screen.getByRole("status")).toHaveTextContent(/403 Forbidden/i);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("Refresh posts a second load for the picked set", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["acme/app"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    if (url.includes("/api/live/load") && init?.method === "POST") {
      return jsonResponse({
        issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => {
    const loads = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/api/live/load") && init?.method === "POST",
    );
    expect(loads).toHaveLength(2);
  });
});

test("shows enriching progress while a load is in flight", async () => {
  let resolveLoad: ((value: Response) => void) | undefined;
  const loadPromise = new Promise<Response>((resolve) => {
    resolveLoad = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return jsonResponse({
          status: "running",
          current: 3,
          total: 20,
          detail: "Enriching 3 of 20…",
        });
      }
      if (url.includes("/api/live/load") && init?.method === "POST") {
        return loadPromise;
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText(/Enriching 3 of 20/i);
  resolveLoad?.(
    jsonResponse({
      issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
    }),
  );
  await screen.findByText("Real issue");
});

test("shows a timeout message instead of spinning when load fetch aborts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      if (url.includes("/api/live/load") && init?.method === "POST") {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByRole("alert");
  expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
});

test("shows a clear API-down message when preflight cannot reach FastAPI", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse(
          { error: "The API is not running on localhost:8000. Start FastAPI, then refresh." },
          503,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByRole("alert");
  expect(screen.getByText(/api is not running/i)).toBeInTheDocument();
  expect(screen.queryByText("Pick repositories")).not.toBeInTheDocument();
});

const snapshotIssue = {
  id: 11,
  title: "Real issue",
  score: 1.2,
  repo: "mozilla-ai/otari",
  status: "backlog" as const,
};

test("return visit paints last issues and re-checks last repos without loading Otari", async () => {
  sessionState.userId = "12345";
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [snapshotIssue],
  });
  const fetchMock = vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["mozilla-ai/otari", "acme/app"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("Real issue");
  const checkbox = await screen.findByRole("checkbox", { name: "mozilla-ai/otari" });
  expect(checkbox).toBeChecked();
  expect(
    fetchMock.mock.calls.filter(([url, init]) => String(url).includes("/api/live/load") && init?.method === "POST"),
  ).toHaveLength(0);
});

test("Refresh sits at the top of the live board once issues are painted", async () => {
  sessionState.userId = "12345";
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [snapshotIssue],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["mozilla-ai/otari"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  const refresh = await screen.findByRole("button", { name: "Refresh" });
  const pick = await screen.findByRole("group", { name: "Pick repositories" });
  expect(refresh.compareDocumentPosition(pick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(refresh).toHaveClass("live-board-refresh");
  expect(document.querySelector(".live-board-picker-fold")).not.toHaveAttribute("open");
});


test("failed Refresh keeps the painted board and the snapshot", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["acme/app"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    if (url.includes("/api/live/load") && init?.method === "POST") {
      const loads = fetchMock.mock.calls.filter(
        ([callUrl, callInit]) => String(callUrl).includes("/api/live/load") && callInit?.method === "POST",
      );
      if (loads.length > 1) {
        return jsonResponse({ detail: "Otari failed (TimeoutError)" }, 503);
      }
      return jsonResponse({
        issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("status");
  expect(screen.getByText(/otari failed/i)).toBeInTheDocument();
  expect(screen.getByText("Real issue")).toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.issues[0]?.title).toBe("Real issue");
});

test("a failed Load of a new pick keeps the previous painted board", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["acme/app", "acme/other"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    if (url.includes("/api/live/load") && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}")) as { repos?: string[] };
      if (body.repos?.includes("acme/other")) {
        return jsonResponse({ detail: "Otari failed (TimeoutError)" }, 503);
      }
      return jsonResponse({
        issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/other" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByRole("status");
  expect(screen.getByText("Real issue")).toBeInTheDocument();
});

test("a different GitHub user hides the board and wipes the snapshot", async () => {
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [snapshotIssue],
  });
  sessionState.userId = "999";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["mozilla-ai/otari"] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("mozilla-ai/otari");
  expect(screen.queryByText("Real issue")).not.toBeInTheDocument();
  expect(window.localStorage.getItem(LIVE_BOARD_SNAPSHOT_KEY)).toBeNull();
});

test("left rail shows GitHub identity and the current board", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  const rail = await screen.findByRole("complementary", { name: "Boards and profile" });
  expect(within(rail).getByText("Ada Lovelace")).toBeInTheDocument();
  expect(within(rail).getByText("ada@example.com")).toBeInTheDocument();
  expect(within(rail).getByRole("button", { name: "Board 1" })).toHaveAttribute("aria-current", "page");
});

test("Pick repositories stays collapsed after a successful load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      if (url.includes("/api/live/load") && init?.method === "POST") {
        return jsonResponse({
          issues: [{ id: 11, title: "Real issue", score: 1.2, repo: "acme/app", status: "backlog" }],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Real issue");
  expect(document.querySelector(".live-board-picker-fold")).not.toHaveAttribute("open");
});

test("renames the active board from the left rail", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByRole("heading", { name: "Board 1" });
  fireEvent.change(screen.getByLabelText("Rename board"), { target: { value: "cq live" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(await screen.findByRole("heading", { name: "cq live" })).toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards[0]?.name).toBe("cq live");
});

test("New board keeps the previous board and opens an empty pick", async () => {
  sessionState.userId = "12345";
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [snapshotIssue],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["mozilla-ai/otari"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("Real issue");
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  expect(screen.queryByText("Real issue")).not.toBeInTheDocument();
  expect(document.querySelector(".live-board-picker-fold")).toHaveAttribute("open");
  fireEvent.click(screen.getByRole("button", { name: "Board 1" }));
  expect(await screen.findByText("Real issue")).toBeInTheDocument();
});

test("hover delete removes a named board and keeps the others", async () => {
  sessionState.userId = "12345";
  writeLiveBoardSnapshot({
    githubUserId: "12345",
    selectedRepos: ["mozilla-ai/otari"],
    issues: [snapshotIssue],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["mozilla-ai/otari"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("Real issue");
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  expect(screen.queryByText("Real issue")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete Board 2" }));
  expect(await screen.findByText("Real issue")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Board 2" })).not.toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards.map((board) => board.id)).toEqual(["board-1"]);
});

test("deleting the last board leaves one empty default board", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/live/preflight")) {
        return jsonResponse({
          ready: true,
          github: "ok",
          otari: "ok",
          github_error: null,
          otari_error: null,
        });
      }
      if (url.includes("/api/live/repos")) {
        return jsonResponse({ repos: ["acme/app"] });
      }
      if (url.includes("/api/live/progress")) {
        return idleProgress();
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );

  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByRole("heading", { name: "Board 1" });
  fireEvent.click(screen.getByRole("button", { name: "Delete Board 1" }));
  expect(await screen.findByRole("heading", { name: "Board 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Board 1" })).toHaveAttribute("aria-current", "page");
  expect(document.querySelector(".live-board-picker-fold")).toHaveAttribute("open");
});

const pairIssues = [
  {
    id: 11,
    title: "Login leak",
    score: 1.2,
    repo: "acme/app",
    number: 1,
    status: "backlog" as const,
    summary: "Users can enumerate logins.",
  },
  {
    id: 12,
    title: "Signup leak",
    score: 1.1,
    repo: "acme/app",
    number: 2,
    status: "backlog" as const,
    summary: "Signup repeats the same leak.",
  },
];

function boardFetch(options?: {
  issues?: unknown[];
  overlap?: unknown;
  overlapStatus?: number;
  refreshIssues?: unknown[];
}) {
  let loads = 0;
  return vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/live/preflight")) {
      return jsonResponse({
        ready: true,
        github: "ok",
        otari: "ok",
        github_error: null,
        otari_error: null,
      });
    }
    if (url.includes("/api/live/repos")) {
      return jsonResponse({ repos: ["acme/app"] });
    }
    if (url.includes("/api/live/progress")) {
      return idleProgress();
    }
    if (url.includes("/api/live/load") && init?.method === "POST") {
      loads += 1;
      if (loads > 1 && options?.refreshIssues) {
        return jsonResponse({ issues: options.refreshIssues });
      }
      return jsonResponse({ issues: options?.issues ?? pairIssues });
    }
    if (url.includes("/api/live/overlap") && init?.method === "POST") {
      if (options?.overlapStatus && options.overlapStatus >= 400) {
        return jsonResponse(options.overlap ?? { detail: "Otari overlap failed" }, options.overlapStatus);
      }
      return jsonResponse(
        options?.overlap ?? {
          overlap_index: 4,
          reason: "Same credential leak.",
          cited_issue_keys: ["acme/app#1", "acme/app#2"],
        },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function loadPair() {
  render(<LiveBoard dashboardPollMs={0} />);
  await screen.findByText("acme/app");
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/app" }));
  fireEvent.click(screen.getByRole("button", { name: "Load board" }));
  await screen.findByText("Login leak");
}

test("Load, Refresh, and Consolidate use inference chrome; local actions stay flat", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  expect(screen.getByRole("button", { name: "Load board" })).toHaveClass("btn-inference");
  expect(screen.getByRole("button", { name: "Refresh" })).toHaveClass("btn-inference");
  expect(screen.getByRole("button", { name: "Consolidate" })).toHaveClass("btn-inference");
  expect(screen.getByRole("button", { name: "Deconstruct" })).not.toHaveClass("btn-inference");
  expect(screen.getByRole("button", { name: "Select all" })).not.toHaveClass("btn-inference");
  expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute(
    "aria-describedby",
    "otari-inference-hint",
  );
  const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
  expect(css).toMatch(/\.btn-inference\s*\{/);
  expect(css).toMatch(/\.issue-card-summary\s*\{[\s\S]*border-left:\s*3px solid var\(--accent\)/);
});

test("select all and deselect toggle every visible GitHub ticket", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByRole("checkbox", { name: "Select acme/app#1" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select acme/app#2" })).toBeChecked();
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Deselect" }));
  expect(screen.getByRole("checkbox", { name: "Select acme/app#1" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Select acme/app#2" })).not.toBeChecked();
  expect(screen.getByText("Select tickets to deconstruct or consolidate.")).toBeInTheDocument();
});

test("deconstructs two selected tickets under a FeatureMania parent", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  expect(screen.getByRole("button", { name: "Deconstruct" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  expect(screen.getByRole("button", { name: "Deconstruct" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Deconstruct" }));
  const dialog = screen.getByRole("dialog", { name: "Deconstruct into a parent" });
  expect(within(dialog).getByRole("button", { name: "Create parent" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Parent title"), { target: { value: "Auth cleanup" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create parent" }));
  expect(screen.getByText("Auth cleanup")).toBeInTheDocument();
  expect(screen.getByText("FeatureMania parent")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Login leak" })).not.toBeInTheDocument();
  expect(screen.getByText("Login leak")).toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards[0]?.groups[0]?.mode).toBe("parent");
});

test("keeps a new parent in memory when localStorage cannot persist", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  fireEvent.click(screen.getByRole("button", { name: "Deconstruct" }));
  fireEvent.change(screen.getByLabelText("Parent title"), { target: { value: "Auth cleanup" } });
  fireEvent.click(screen.getByRole("button", { name: "Create parent" }));
  expect(screen.getByText("Auth cleanup")).toBeInTheDocument();
  setItem.mockRestore();
});

test("scores overlap then consolidates only after confirm", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  const dialog = await screen.findByRole("dialog", { name: "Consolidate issues" });
  expect(dialog).toHaveTextContent("Overlap 4 same work");
  expect(dialog).toHaveTextContent("Likely worth consolidating");
  expect(within(dialog).getByRole("region", { name: "Overlap score" })).toBeInTheDocument();
  expect(within(dialog).getByRole("region", { name: "Overlap description" })).toBeInTheDocument();
  expect(within(dialog).getByRole("textbox", { name: "Consolidated title" })).toBeInTheDocument();
  const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
  expect(css).toMatch(
    /\.score-dialog-stack \.dialog-block\s*\+\s*\.dialog-block[\s\S]*?border-top:\s*1px solid var\(--border\)/,
  );
  expect(css).toMatch(/\.score-dialog-stack\s*\{[\s\S]*?gap:\s*1\.15rem/);
  expect(screen.getByRole("heading", { name: "Login leak" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Consolidate issues" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Login leak" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  await screen.findByRole("dialog", { name: "Consolidate issues" });
  fireEvent.change(screen.getByRole("textbox", { name: "Consolidated title" }), {
    target: { value: "Auth leak" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm consolidate" }));
  expect(screen.getByText("Auth leak")).toBeInTheDocument();
  expect(screen.getByText("Consolidated in FeatureMania")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Login leak" })).not.toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards[0]?.groups[0]?.mode).toBe("merge");
});

test("a low overlap score still allows confirm and cancel writes nothing", async () => {
  vi.stubGlobal(
    "fetch",
    boardFetch({
      overlap: { overlap_index: 1, reason: "weak theme only", cited_issue_keys: ["acme/app#1"] },
    }),
  );
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  const dialog = await screen.findByRole("dialog", { name: "Consolidate issues" });
  expect(dialog).toHaveTextContent("may not overlap");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(readLiveBoardSnapshot()?.boards[0]?.groups).toEqual([]);
});

test("overlap failure leaves the board unchanged", async () => {
  vi.stubGlobal("fetch", boardFetch({ overlap: { detail: "Otari overlap failed" }, overlapStatus: 503 }));
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  await screen.findByText(/otari overlap failed/i);
  expect(screen.getByRole("heading", { name: "Login leak" })).toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards[0]?.groups).toEqual([]);
});

test("plain-text overlap failures still show the server message", async () => {
  const fetchMock = boardFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).includes("/api/live/overlap") && init?.method === "POST") {
        return new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      return fetchMock(input, init);
    }),
  );
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  await screen.findByText(/internal server error/i);
});

test("a missing overlap route tells the user to restart the web app", async () => {
  const fetchMock = boardFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).includes("/api/live/overlap") && init?.method === "POST") {
        return new Response(
          "<!DOCTYPE html><html lang=\"en\"><head><link rel=\"stylesheet\" href=\"/_next/static/css/app/layout.css\"/></head><body>Not Found</body></html>",
          {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      return fetchMock(input, init);
    }),
  );
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  const dialog = await screen.findByRole("dialog", { name: "Consolidate issues" });
  expect(dialog).toHaveTextContent("Overlap is not available. Restart the web app.");
  expect(dialog).not.toHaveTextContent("<!DOCTYPE");
});

test("HTML overlap failures show the fallback instead of the page markup", async () => {
  const fetchMock = boardFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      if (String(input).includes("/api/live/overlap") && init?.method === "POST") {
        return new Response(
          "<!DOCTYPE html><html lang=\"en\"><head><meta charSet=\"utf-8\"/><link rel=\"stylesheet\" href=\"/_next/static/css/app/layout.css\"/></head><body>Internal Server Error</body></html>",
          {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      return fetchMock(input, init);
    }),
  );
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Consolidate" }));
  const dialog = await screen.findByRole("dialog", { name: "Consolidate issues" });
  expect(dialog).toHaveTextContent("Otari could not score overlap");
  expect(dialog).not.toHaveTextContent("<!DOCTYPE");
  expect(dialog).not.toHaveTextContent("layout.css");
});

test("Refresh keeps grouping when sqlite ids change", async () => {
  vi.stubGlobal(
    "fetch",
    boardFetch({
      refreshIssues: [
        { ...pairIssues[0], id: 99 },
        { ...pairIssues[1], id: 100 },
      ],
    }),
  );
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Deconstruct" }));
  fireEvent.change(screen.getByLabelText("Parent title"), { target: { value: "Auth cleanup" } });
  fireEvent.click(screen.getByRole("button", { name: "Create parent" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => {
    expect(screen.getByText("Auth cleanup")).toBeInTheDocument();
  });
  expect(screen.queryByRole("heading", { name: "Login leak" })).not.toBeInTheDocument();
});

test("Undo restores children after deconstruct or consolidate", async () => {
  vi.stubGlobal("fetch", boardFetch());
  await loadPair();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#1" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select acme/app#2" }));
  fireEvent.click(screen.getByRole("button", { name: "Deconstruct" }));
  fireEvent.change(screen.getByLabelText("Parent title"), { target: { value: "Auth cleanup" } });
  fireEvent.click(screen.getByRole("button", { name: "Create parent" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo grouping" }));
  expect(screen.getByRole("heading", { name: "Login leak" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Signup leak" })).toBeInTheDocument();
  expect(readLiveBoardSnapshot()?.boards[0]?.groups).toEqual([]);
});



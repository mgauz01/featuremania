import { NextRequest } from "next/server";
import { proxyLiveApi } from "@/lib/github-bff";

const OVERLAP_TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  return proxyLiveApi(
    req,
    "/v1/boards/overlap",
    {
      method: "POST",
      body: await req.text(),
    },
    OVERLAP_TIMEOUT_MS,
  );
}

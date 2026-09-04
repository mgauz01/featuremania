import { NextRequest } from "next/server";
import { LOAD_TIMEOUT_MS, proxyLiveApi } from "@/lib/github-bff";

export async function POST(req: NextRequest) {
  return proxyLiveApi(
    req,
    "/v1/boards/load",
    {
      method: "POST",
      body: await req.text(),
    },
    LOAD_TIMEOUT_MS,
  );
}

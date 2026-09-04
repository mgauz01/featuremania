import { NextRequest } from "next/server";
import { proxyLiveApi } from "@/lib/github-bff";

export async function POST(req: NextRequest) {
  return proxyLiveApi(req, "/v1/boards/overlap", {
    method: "POST",
    body: await req.text(),
  });
}

import { NextRequest } from "next/server";
import { proxyLiveApi } from "@/lib/github-bff";

export async function GET(req: NextRequest) {
  return proxyLiveApi(req, "/v1/boards/load/progress");
}

import { getChatGPTUser } from "../../../chatgpt-auth";

export async function GET(request: Request) {
  const workerUrl = process.env.MEDIA_WORKER_URL;
  const workerToken = process.env.MEDIA_WORKER_TOKEN;
  const assetUrl = new URL(request.url).searchParams.get("url");

  if (!workerUrl || !assetUrl) {
    return Response.json({ detail: "Playable asset URL is missing" }, { status: 400 });
  }

  const user = await getChatGPTUser();
  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/assets/play?url=${encodeURIComponent(assetUrl)}`, {
    method: "GET",
    redirect: "manual",
    headers: {
      "x-continuity-user": user?.email ?? "anonymous",
      ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {}),
    },
  });

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    return Response.redirect(location, 302);
  }

  return Response.json({ detail: "Could not refresh this B2 asset" }, { status: response.status || 400 });
}

import { getChatGPTUser } from "../chatgpt-auth";

export async function forwardToWorker(path: string, request: Request) {
  const user = await getChatGPTUser();
  const workerUrl = process.env.MEDIA_WORKER_URL;
  const workerToken = process.env.MEDIA_WORKER_TOKEN;

  if (!workerUrl) {
    return Response.json(
      { mode: "demo", ok: true, message: "Media worker is not connected on this deployment." },
      { status: 200 },
    );
  }

  const body = request.method === "GET" ? undefined : await request.text();
  const response = await fetch(`${workerUrl.replace(/\/$/, "")}${path}`, {
    method: request.method,
    headers: {
      "content-type": "application/json",
      "x-continuity-user": user?.email ?? "anonymous",
      ...(workerToken ? { authorization: `Bearer ${workerToken}` } : {}),
    },
    body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

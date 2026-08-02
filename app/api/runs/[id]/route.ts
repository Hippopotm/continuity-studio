import { forwardToWorker } from "../../_worker";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return forwardToWorker(`/v1/runs/${encodeURIComponent(id)}`, request);
}

import { forwardToWorker } from "../_worker";

export async function POST(request: Request) {
  return forwardToWorker("/v1/character-visuals", request);
}

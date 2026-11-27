import type { Net } from "../http.ts";
import type { Adapter } from "./adapter.ts";

// STUB so this branch compiles. The real file is written in parallel (P5-a); the combine step takes that one.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export function slackAdapter(
  _cfg: { botToken: string; appToken: string; me: string },
  _net: Net,
  _openSocket: (url: string) => WebSocketLike,
): Adapter & { start(): Promise<void>; stop(): void } {
  throw new Error("not implemented");
}

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { platform } from "node:os";
import type { RpcRequest, RpcResponse } from "@narthex/core";
import type { Engine } from "./engine.ts";
import type { Host } from "./host.ts";

/** What the server and in-process clients need: one engine, or a host running several companies. */
export type Serving = Pick<Engine | Host, "handle" | "subscribe">;

/**
 * Serves the engine on a local socket (JSON lines), so the CLI and the desktop app
 * can share one running company. Local only: a Unix socket in the user's data folder,
 * or a per-user named pipe on Windows. Nothing listens on the network.
 */
export async function serve(engine: Serving, path: string): Promise<Server> {
  if (platform() !== "win32" && existsSync(path)) {
    if (await isAlive(path)) throw new Error("Narthex is already running (another engine is listening on this folder).");
    unlinkSync(path);
  }
  const server = createServer((socket) => attach(engine, socket));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  // Only the player's own account may talk to their company.
  if (platform() !== "win32") chmodSync(path, 0o600);
  return server;
}

function attach(engine: Serving, socket: Socket): void {
  socket.setEncoding("utf8");
  const unsubscribe = engine.subscribe((event) => write(socket, { event }));
  socket.on("close", unsubscribe);
  socket.on("error", unsubscribe);
  readLines(socket, async (line) => {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      return;
    }
    // Same-user peers only, but a malformed line must never take the engine down.
    if (!request || typeof request !== "object" || typeof request.method !== "string") return;
    let response: RpcResponse;
    try {
      response = { id: request.id, result: await engine.handle(request.method, request.params) };
    } catch (e) {
      response = { id: request.id, error: { message: e instanceof Error ? e.message : String(e) } };
    }
    write(socket, response);
  });
}

export function write(socket: Socket, message: unknown): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

/** A line longer than this is not a request: the peer is dropped. */
const MAX_LINE = 8 * 1024 * 1024;

export function readLines(socket: Socket, onLine: (line: string) => void | Promise<void>): void {
  let buffer = "";
  socket.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();
    if (buffer.length > MAX_LINE && buffer.indexOf("\n") < 0) {
      socket.destroy();
      return;
    }
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) void Promise.resolve(onLine(line)).catch(() => {});
    }
  });
}

export function isAlive(path: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const done = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs).unref();
  });
}

import { createConnection, type Socket } from "node:net";
import type { Method, Params, Result, RpcNotification, RpcResponse, StoredEvent } from "@narthex/core";
import type { Serving } from "./server.ts";
import { readLines, write } from "./server.ts";

/** What every front end talks to, whether the engine runs in the same process or elsewhere. */
export interface Client {
  call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>;
  subscribe(listener: (event: StoredEvent) => void): () => void;
  close(): Promise<void>;
}

export class InProcessClient implements Client {
  private readonly engine: Serving;

  constructor(engine: Serving) {
    this.engine = engine;
  }

  call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    return this.engine.handle(method, params);
  }

  subscribe(listener: (event: StoredEvent) => void): () => void {
    return this.engine.subscribe(listener);
  }

  async close(): Promise<void> {}
}

export class SocketClient implements Client {
  private readonly socket: Socket;
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly listeners = new Set<(event: StoredEvent) => void>();
  private nextId = 1;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    readLines(socket, (line) => {
      let message: RpcResponse | RpcNotification;
      try {
        message = JSON.parse(line) as RpcResponse | RpcNotification;
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      if ("event" in message) {
        for (const l of this.listeners) l(message.event);
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if ("error" in message) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.on("close", () => {
      for (const w of this.pending.values()) w.reject(new Error("Connexion au moteur perdue."));
      this.pending.clear();
    });
  }

  /** Connects to a running engine, or resolves null when none is listening. */
  static connect(path: string, timeoutMs = 800): Promise<SocketClient | null> {
    return new Promise((resolve) => {
      const socket = createConnection(path);
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(new SocketClient(socket));
      });
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.socket.destroyed) return reject(new Error("Connexion au moteur perdue."));
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      write(this.socket, { id, method, params });
    });
  }

  subscribe(listener: (event: StoredEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.socket.end();
  }
}

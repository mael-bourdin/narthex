import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LeaderboardEntry, Method, Params, Result, RuntimeName, StoredEvent } from "@narthex/core";

/** The only bridge between the page and the engine: the same API as the CLI, nothing more. */
const api = {
  call<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    return ipcRenderer.invoke("narthex:call", method, params) as Promise<Result<M>>;
  },
  onEvent(listener: (event: StoredEvent) => void): () => void {
    const handler = (_e: IpcRendererEvent, event: StoredEvent) => listener(event);
    ipcRenderer.on("narthex:event", handler);
    return () => ipcRenderer.removeListener("narthex:event", handler);
  },
  onboarding: {
    needsKey: (): Promise<boolean> => ipcRenderer.invoke("narthex:onboarding:needsKey") as Promise<boolean>,
    /** Checks and saves the key; `applied` is false when another process runs the engine (it applies on its next start). */
    submitKey: (key: string): Promise<{ ok: true; applied: boolean } | { ok: false; message: string }> =>
      ipcRenderer.invoke("narthex:onboarding:submitKey", key) as Promise<{ ok: true; applied: boolean } | { ok: false; message: string }>,
  },
  config: {
    get: (): Promise<{
      dir: string;
      hasKey: boolean;
      keyHint: string | null;
      runtime: RuntimeName;
      models: Partial<Record<string, string>>;
      notifications: { legal: boolean; leaving: boolean; budget: boolean; deliverables: boolean };
      ownsEngine: boolean;
    }> => ipcRenderer.invoke("narthex:config:get"),
    setModels: (models: Record<string, string>): Promise<void> => ipcRenderer.invoke("narthex:config:setModels", models),
    setNotifications: (n: Record<string, boolean>): Promise<void> => ipcRenderer.invoke("narthex:config:setNotifications", n),
  },
  deliverable: {
    /** Asks where to save it; resolves to the file path, or null if the founder cancelled. */
    save: (id: string): Promise<string | null> => ipcRenderer.invoke("narthex:deliverable:save", id),
  },
  leaderboard: {
    get: (): Promise<{
      edition: "open-source" | "hosted";
      share: boolean;
      showRevenue: boolean;
      online: boolean;
      joinable: boolean;
      mine: string[];
      entries: { rank: number; entry: LeaderboardEntry }[];
      error: string | null;
    }> => ipcRenderer.invoke("narthex:leaderboard:get"),
    set: (choice: { share: boolean; showRevenue: boolean }): Promise<void> => ipcRenderer.invoke("narthex:leaderboard:set", choice),
  },
  discord: {
    get: (): Promise<{ connected: boolean; guildName: string | null; hasToken: boolean; ownsEngine: boolean }> => ipcRenderer.invoke("narthex:discord:get"),
    check: (token: string): Promise<{ ok: true; bot: string; guilds: { id: string; name: string }[] } | { ok: false; message: string }> => ipcRenderer.invoke("narthex:discord:check", token),
    save: (choice: { token: string; guildId: string; guildName: string }): Promise<void> => ipcRenderer.invoke("narthex:discord:save", choice),
    off: (): Promise<void> => ipcRenderer.invoke("narthex:discord:off"),
  },
  data: {
    export: (): Promise<string> => ipcRenderer.invoke("narthex:data:export"),
    restart: (): Promise<string | null> => ipcRenderer.invoke("narthex:data:restart"),
  },
  platform: process.platform,
};

export type NarthexApi = typeof api;

contextBridge.exposeInMainWorld("narthex", api);

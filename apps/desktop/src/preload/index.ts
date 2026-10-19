import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Method, Params, Result, StoredEvent } from "@narthex/core";

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
    submitKey: (key: string): Promise<{ ok: true } | { ok: false; message: string }> =>
      ipcRenderer.invoke("narthex:onboarding:submitKey", key) as Promise<{ ok: true } | { ok: false; message: string }>,
    useSimulation: (): Promise<void> => ipcRenderer.invoke("narthex:onboarding:useSimulation") as Promise<void>,
  },
  platform: process.platform,
};

export type NarthexApi = typeof api;

contextBridge.exposeInMainWorld("narthex", api);

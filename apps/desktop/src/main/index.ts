import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import type { Method, Params } from "@narthex/core";
import {
  AnthropicRuntime,
  dataDir,
  InProcessClient,
  loadConfig,
  needsKey,
  openEngine,
  saveKey,
  serve,
  SocketClient,
  socketPath,
  verifyAnthropicKey,
  type Client,
  type Engine,
} from "@narthex/engine";

/**
 * The app is a thin client. If `narthex lancer` already runs the company in a terminal,
 * we join it; otherwise the app runs the engine itself and serves it so the CLI can join.
 */
let client: Client | undefined;
let engine: Engine | undefined;
let closeServer: (() => void) | undefined;
let window: BrowserWindow | undefined;

const dir = dataDir();

async function connect(): Promise<Client> {
  const existing = await SocketClient.connect(socketPath(dir));
  if (existing) return existing;
  engine = openEngine({ dir }).engine;
  const server = await serve(engine, socketPath(dir));
  closeServer = () => server.close();
  engine.start();
  return new InProcessClient(engine);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0B0C16",
    title: "Narthex",
    // NARTHEX_HEADLESS: render off screen (visual checks, CI), never in the player's face.
    show: !process.env.NARTHEX_HEADLESS,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  if (process.env.NARTHEX_SNAPSHOT) snapshot(window, process.env.NARTHEX_SNAPSHOT);
}

/** NARTHEX_SNAPSHOT=out.png: saves a picture of the window, then quits (docs, visual checks, CI). */
function snapshot(win: BrowserWindow, file: string): void {
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(file, image.toPNG());
      app.quit();
    }, Number(process.env.NARTHEX_SNAPSHOT_DELAY ?? 2500));
  });
}

ipcMain.handle("narthex:call", async (_event, method: Method, params: Params<Method>) => {
  if (!client) throw new Error("Le moteur démarre…");
  return client.call(method, params);
});

// First launch (« le seuil »). The key never reaches the page's storage: it goes straight to config.json.
ipcMain.handle("narthex:onboarding:needsKey", () => needsKey(loadConfig(dir)));
ipcMain.handle("narthex:onboarding:submitKey", async (_event, key: string) => {
  const check = await verifyAnthropicKey(String(key));
  if (!check.ok) return check;
  const config = saveKey(dir, check.key);
  // When we run the engine, the team starts working with Claude right away.
  engine?.useRuntime(new AnthropicRuntime({ apiKey: check.key, ...(config.model ? { model: config.model } : {}) }));
  return { ok: true, applied: Boolean(engine) };
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  client = await connect();
  client.subscribe((event) => window?.webContents.send("narthex:event", event));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || !engine) return;
  event.preventDefault();
  quitting = true;
  closeServer?.();
  // Let agents finish what they started; their work is never left half-recorded.
  void engine.close().finally(() => app.quit());
});

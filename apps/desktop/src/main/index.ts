import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, shell } from "electron";
import { deliverableMarkdown, overBudget, type Method, type Params, type RoleId, type StoredEvent } from "@narthex/core";
import {
  AnthropicRuntime,
  apiKey,
  archiveCompany,
  chooseRuntime,
  saveConfig,
  dataDir,
  InProcessClient,
  loadConfig,
  needsKey,
  openEngine,
  startDiscord,
  LeaderboardPublisher,
  fetchLeaderboard,
  leaderboardSettings,
  checkDiscordToken,
  saveKey,
  serve,
  SocketClient,
  socketPath,
  verifyAnthropicKey,
  type Client,
  type Host,
} from "@narthex/engine";

/**
 * The app is a thin client. If `narthex lancer` already runs the company in a terminal,
 * we join it; otherwise the app runs the engine itself and serves it so the CLI can join.
 */
let client: Client | undefined;
let engine: Host | undefined;
let closeServer: (() => void) | undefined;
let unsubscribe: (() => void) | undefined;
let window: BrowserWindow | undefined;

const dir = dataDir();

async function connect(): Promise<Client> {
  const existing = await SocketClient.connect(socketPath(dir));
  if (existing) return existing;
  try {
    engine = openEngine({ dir }).engine;
  } catch (e) {
    // Another Narthex owns the data (« narthex lancer » busy starting): wait for its socket instead.
    for (let i = 0; i < 5; i++) {
      const late = await SocketClient.connect(socketPath(dir), 2_000);
      if (late) return late;
    }
    throw e;
  }
  const server = await serve(engine, socketPath(dir));
  closeServer = () => server.close();
  engine.start();
  restartDiscord();
  publisher = new LeaderboardPublisher({ host: engine, settings: () => leaderboardSettings(loadConfig(dir)) });
  publisher.start();
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

/** NARTHEX_SNAPSHOT=out.png: saves a picture of the window, then quits (docs, visual checks, CI). NARTHEX_SNAPSHOT_TAB opens a tab first. */
function snapshot(win: BrowserWindow, file: string): void {
  win.webContents.once("did-finish-load", () => {
    const tab = process.env.NARTHEX_SNAPSHOT_TAB;
    if (tab) setTimeout(() => void win.webContents.executeJavaScript(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(tab)})?.click()`), 1500);
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
  engine?.useRuntime(new AnthropicRuntime({ apiKey: check.key, ...(config.model ? { model: config.model } : {}), ...(config.models ? { models: config.models } : {}) }));
  return { ok: true, applied: Boolean(engine) };
});

// ---------- Réglages ----------

ipcMain.handle("narthex:config:get", () => {
  const config = loadConfig(dir);
  const key = config.anthropicApiKey;
  return {
    dir,
    hasKey: Boolean(key),
    keyHint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
    runtime: chooseRuntime(config),
    models: config.models ?? {},
    notifications: { legal: true, leaving: true, budget: true, deliverables: false, ...config.notifications },
    ownsEngine: Boolean(engine),
  };
});

// ---------- Classement ----------

let publisher: LeaderboardPublisher | undefined;

ipcMain.handle("narthex:leaderboard:get", async () => {
  const settings = leaderboardSettings(loadConfig(dir));
  const companies = client ? (await client.call("companies.list", {})).map((c) => c.id) : [];
  const base = { edition: settings.edition, share: settings.share, showRevenue: settings.showRevenue, online: Boolean(settings.url), joinable: settings.edition === "hosted" && Boolean(settings.token), mine: companies };
  if (!settings.url) return { ...base, entries: [], error: null };
  try {
    return { ...base, entries: await fetchLeaderboard(settings.url), error: null };
  } catch (e) {
    return { ...base, entries: [], error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("narthex:leaderboard:set", async (_e, choice: { share: boolean; showRevenue: boolean }) => {
  const config = loadConfig(dir);
  const was = config.leaderboard?.share ?? false;
  saveConfig(dir, { ...config, leaderboard: { ...config.leaderboard, share: choice.share, showRevenue: choice.showRevenue } });
  if (!client) return;
  const ids = (await client.call("companies.list", {})).map((c) => c.id);
  // Leaving the ranking removes the companies at once; joining publishes them now.
  if (was && !choice.share) for (const id of ids) await publisher?.withdraw(id);
  else {
    publisher?.stop();
    publisher?.start();
  }
});

// ---------- Discord ----------

let stopDiscord: (() => void) | undefined;

/** (Re)starts the team chat on Discord from the config, when this app runs the companies. */
function restartDiscord(): void {
  stopDiscord?.();
  stopDiscord = engine ? startDiscord(engine, dir, (e) => console.error(`Discord : ${e.message}`)) : undefined;
}

ipcMain.handle("narthex:discord:get", () => {
  const d = loadConfig(dir).discord;
  return { connected: Boolean(d?.token && d.guildId), guildName: d?.guildName ?? null, hasToken: Boolean(d?.token), ownsEngine: Boolean(engine) };
});

ipcMain.handle("narthex:discord:check", (_e, token: string) => checkDiscordToken(token));

ipcMain.handle("narthex:discord:save", (_e, choice: { token: string; guildId: string; guildName: string }) => {
  const config = loadConfig(dir);
  // A new server starts with no channels: they are made on the first message of each company.
  const sameServer = config.discord?.guildId === choice.guildId;
  saveConfig(dir, { ...config, discord: { token: choice.token.trim(), guildId: choice.guildId, guildName: choice.guildName, ...(sameServer && config.discord?.setups ? { setups: config.discord.setups } : {}) } });
  restartDiscord();
});

ipcMain.handle("narthex:discord:off", () => {
  const { discord: _gone, ...rest } = loadConfig(dir);
  saveConfig(dir, rest);
  restartDiscord();
});

ipcMain.handle("narthex:config:setModels", (_e, models: Partial<Record<RoleId, string>>) => {
  const config = { ...loadConfig(dir), models };
  saveConfig(dir, config);
  const key = apiKey(config, {});
  // The team picks the new models from its next turn on.
  if (engine && key && chooseRuntime(config) === "anthropic") engine.useRuntime(new AnthropicRuntime({ apiKey: key, models, ...(config.model ? { model: config.model } : {}) }));
});

ipcMain.handle("narthex:config:setNotifications", (_e, notifications: Record<string, boolean>) => {
  saveConfig(dir, { ...loadConfig(dir), notifications });
});

ipcMain.handle("narthex:data:export", async () => {
  if (!client) throw new Error("Le moteur démarre…");
  const events = await client.call("events.read", {});
  const state = await client.call("state.get", {});
  const name = (state?.company?.name ?? "narthex").replace(/[^\p{L}\p{N}-]+/gu, "-");
  const file = join(app.getPath("downloads") || join(homedir(), "Downloads"), `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), company: state?.company, events }, null, 2));
  shell.showItemInFolder(file);
  return file;
});

ipcMain.handle("narthex:deliverable:save", async (e, id: string) => {
  if (!client) throw new Error("Le moteur démarre…");
  const state = await client.call("state.get", {});
  const d = state?.deliverables[id];
  if (!state || !d) throw new Error("Livrable introuvable.");
  const name = d.title.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "") || "livrable";
  const window = BrowserWindow.fromWebContents(e.sender);
  const options = { defaultPath: join(app.getPath("documents") || homedir(), `${name}.md`), filters: [{ name: "Markdown", extensions: ["md"] }] };
  const { canceled, filePath } = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return null;
  writeFileSync(filePath, deliverableMarkdown(state, d));
  return filePath;
});

ipcMain.handle("narthex:data:restart", async () => {
  if (!engine) throw new Error("L'équipe tourne dans un terminal (« narthex lancer ») : arrête-la d'abord.");
  unsubscribe?.();
  closeServer?.();
  await engine.close();
  engine = undefined;
  const archived = archiveCompany(dir);
  client = await connect();
  unsubscribe = client.subscribe(forward);
  window?.webContents.reload();
  return archived;
});

// ---------- Notifications ----------

const notifiedBudgetDays = new Set<string>();

function notify(event: StoredEvent): void {
  const prefs = { legal: true, leaving: true, budget: true, deliverables: false, ...loadConfig(dir).notifications };
  if (!Notification.isSupported() || window?.isFocused()) return;
  const show = (title: string, body: string) => {
    const n = new Notification({ title: `${from}${title}`, body, silent: false });
    n.on("click", () => window?.show());
    n.show();
  };
  // Several companies run: the notification speaks of the event's own company, named when it is not the one shown.
  const state = engine?.stateOf(event.companyId) ?? engine?.getState();
  const shown = engine?.status().companyId;
  const from = state?.company && shown && event.companyId !== shown ? `${state.company.name} · ` : "";
  if (event.type === "obligation.opened" && event.obligation.owner === "founder" && prefs.legal) show("À faire par toi", event.obligation.title);
  if (event.type === "obligation.stuck" && prefs.legal) show("L'équipe est bloquée", `${state?.obligations[event.obligationId]?.title ?? "Une obligation"} : il faut ton avis pour reprendre.`);
  if (event.type === "task.planned" && event.task.kind === "external" && prefs.leaving) {
    const who = state?.agents[event.task.agentId]?.name ?? "L'équipe";
    show(`${who} prévoit une action`, `${event.task.title}. Tu peux l'annuler avant son départ.`);
  }
  if (event.type === "post.published" && event.post.kind === "deliverable" && prefs.deliverables) show(state?.agents[event.post.agentId]?.name ?? "Narthex", event.post.text.slice(0, 140));
  if (event.type === "usage.recorded" && prefs.budget && state && overBudget(state, event.ts)) {
    const day = new Date(event.ts).toDateString();
    if (!notifiedBudgetDays.has(day)) {
      notifiedBudgetDays.add(day);
      show("Budget du jour atteint", "L'équipe s'arrête pour aujourd'hui. Tu peux l'augmenter dans Réglages.");
    }
  }
}

function forward(event: StoredEvent): void {
  window?.webContents.send("narthex:event", event);
  notify(event);
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  client = await connect();
  unsubscribe = client.subscribe(forward);
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

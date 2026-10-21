import { avatarUrl, chatFor, type StoredEvent } from "@narthex/core";
import { DiscordApi, setupCompany, type DiscordCompanySetup } from "./connectors/discord.ts";
import { loadConfig, saveConfig } from "./config.ts";
import type { Host } from "./host.ts";

export interface DiscordBridgeOptions {
  host: Pick<Host, "subscribe" | "stateOf" | "remark">;
  api: DiscordApi;
  guildId: string;
  /** Channels already made, per company (saved in the config). */
  setups: Record<string, DiscordCompanySetup>;
  save(companyId: string, setup: DiscordCompanySetup): void;
  onError?(e: Error): void;
}

/**
 * The company on the founder's Discord: every real event of every company, posted in its channel by
 * the agent concerned; reactions; a colleague answering a piece of work in a thread. One message at a
 * time (Discord rate limits), errors never reach the engine.
 */
export class DiscordBridge {
  private readonly options: DiscordBridgeOptions;
  private queue: Promise<void> = Promise.resolve();
  private off: (() => void) | undefined;

  constructor(options: DiscordBridgeOptions) {
    this.options = options;
  }

  start(): void {
    this.off ??= this.options.host.subscribe((event) => {
      this.queue = this.queue.then(() => this.handle(event)).catch((e: unknown) => this.options.onError?.(e instanceof Error ? e : new Error(String(e))));
    });
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
  }

  /** Resolves once every message queued so far is out (tests, shutdown). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async setupFor(companyId: string, companyName: string): Promise<DiscordCompanySetup> {
    const known = this.options.setups[companyId];
    if (known) return known;
    const made = await setupCompany(this.options.api, this.options.guildId, companyName);
    this.options.setups[companyId] = made;
    this.options.save(companyId, made);
    return made;
  }

  private async handle(event: StoredEvent): Promise<void> {
    const state = this.options.host.stateOf(event.companyId);
    if (!state?.company) return;
    const messages = chatFor(state, event);
    if (messages.length === 0) return;
    const setup = await this.setupFor(event.companyId, state.company.name);
    const { api } = this.options;
    for (const m of messages) {
      const channel = setup.channels[m.channel];
      const sent = await api.post(channel, { username: m.as.name, avatarUrl: avatarUrl(m.as.role), content: m.text });
      for (const emoji of m.reactions) await api.react(sent.channel_id ?? channel.id, sent.id, emoji);
      if (!m.replyFrom) continue;
      const text = await this.options.host.remark(event.companyId, { speaker: m.replyFrom, author: m.as.name, text: m.text });
      if (!text) continue;
      const thread = await api.startThread(sent.channel_id ?? channel.id, sent.id, `${m.as.name} · ${m.text.split("\n")[0]!.slice(0, 60)}`);
      await api.post(channel, { username: m.replyFrom.name, avatarUrl: avatarUrl(m.replyFrom.role), content: text }, thread.id);
    }
  }
}

/**
 * Starts the bridge when the founder connected Discord (token and server chosen), from the process that
 * runs the companies (the app or "narthex lancer"). Returns how to stop it.
 */
export function startDiscord(host: DiscordBridgeOptions["host"], dir: string, onError?: (e: Error) => void): (() => void) | undefined {
  const discord = loadConfig(dir).discord;
  if (!discord?.token || !discord.guildId) return undefined;
  const bridge = new DiscordBridge({
    host,
    api: new DiscordApi(discord.token),
    guildId: discord.guildId,
    setups: { ...discord.setups },
    save: (companyId, setup) => {
      const config = loadConfig(dir);
      if (!config.discord) return;
      saveConfig(dir, { ...config, discord: { ...config.discord, setups: { ...config.discord.setups, [companyId]: setup } } });
    },
    ...(onError ? { onError } : {}),
  });
  bridge.start();
  return () => bridge.stop();
}

/** Checks a bot token and lists the servers the bot was invited to. Saves nothing. */
export async function checkDiscordToken(token: string, api = new DiscordApi(token)): Promise<{ ok: true; bot: string; guilds: { id: string; name: string }[] } | { ok: false; message: string }> {
  if (!token.trim()) return { ok: false, message: "Paste the bot token." };
  try {
    const me = await api.me();
    return { ok: true, bot: me.username, guilds: await api.guilds() };
  } catch {
    return { ok: false, message: "This token doesn't work. Copy it again from the Discord developer portal (Bot · Reset Token)." };
  }
}

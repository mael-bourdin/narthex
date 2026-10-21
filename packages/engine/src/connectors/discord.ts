import { CHAT_CHANNELS, type ChannelKey } from "@narthex/core";

/**
 * Discord REST API (v10), with the founder's own bot. The bot creates one category per company,
 * a channel per team, and a webhook in each: through webhooks, every agent posts under its own
 * name and face. Reactions and threads are made by the bot.
 * https://discord.com/developers/docs/reference
 */

type Response = { ok: boolean; status: number; json(): Promise<unknown> };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

const BASE = "https://discord.com/api/v10";

export class DiscordApi {
  private readonly token: string;
  private readonly fetch: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(token: string, deps: { fetch?: Fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    this.token = token.trim();
    this.fetch = deps.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One call; a rate limit (429) waits as Discord asks, three times at most. */
  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json", "user-agent": "Narthex (https://github.com/mael-bourdin/narthex)", ...(auth ? { authorization: `Bot ${this.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 && attempt < 3) {
        const wait = ((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1;
        await this.sleep(Math.min(30, wait) * 1000);
        continue;
      }
      if (res.status === 204) return undefined as T;
      const value = (await res.json().catch(() => ({}))) as T & { message?: string };
      if (!res.ok) throw new Error(`Discord refused (${res.status}): ${value?.message ?? "unknown error"}.`);
      return value;
    }
  }

  me(): Promise<{ id: string; username: string }> {
    return this.call("GET", "/users/@me");
  }

  guilds(): Promise<{ id: string; name: string }[]> {
    return this.call("GET", "/users/@me/guilds");
  }

  createChannel(guildId: string, channel: { name: string; type: 0 | 4; parent_id?: string; topic?: string }): Promise<{ id: string }> {
    return this.call("POST", `/guilds/${guildId}/channels`, channel);
  }

  createWebhook(channelId: string): Promise<{ id: string; token: string }> {
    return this.call("POST", `/channels/${channelId}/webhooks`, { name: "Narthex" });
  }

  /** Posts as someone (name and face); nobody is ever pinged, whatever the text says. */
  post(hook: { webhookId: string; webhookToken: string }, message: { username: string; avatarUrl: string; content: string }, threadId?: string): Promise<{ id: string; channel_id: string }> {
    const query = `?wait=true${threadId ? `&thread_id=${threadId}` : ""}`;
    return this.call(
      "POST",
      `/webhooks/${hook.webhookId}/${hook.webhookToken}${query}`,
      { username: message.username.slice(0, 80), avatar_url: message.avatarUrl, content: message.content.slice(0, 2000), allowed_mentions: { parse: [] } },
      false,
    );
  }

  react(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.call("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  }

  startThread(channelId: string, messageId: string, name: string): Promise<{ id: string }> {
    return this.call("POST", `/channels/${channelId}/messages/${messageId}/threads`, { name: name.slice(0, 100), auto_archive_duration: 1440 });
  }
}

export interface DiscordCompanySetup {
  categoryId: string;
  channels: Record<ChannelKey, { id: string; webhookId: string; webhookToken: string }>;
}

/** A category named after the company, its team channels, a webhook in each. */
export async function setupCompany(api: DiscordApi, guildId: string, companyName: string): Promise<DiscordCompanySetup> {
  const category = await api.createChannel(guildId, { name: companyName.slice(0, 100), type: 4 });
  const channels = {} as DiscordCompanySetup["channels"];
  for (const c of CHAT_CHANNELS) {
    const channel = await api.createChannel(guildId, { name: c.name, type: 0, parent_id: category.id, topic: c.topic });
    const hook = await api.createWebhook(channel.id);
    channels[c.key] = { id: channel.id, webhookId: hook.id, webhookToken: hook.token };
  }
  return { categoryId: category.id, channels };
}

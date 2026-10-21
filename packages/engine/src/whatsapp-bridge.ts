import { chatFor, role, type StoredEvent } from "@narthex/core";
import { runWacli, sendWhatsApp, type WacliRun } from "./connectors/whatsapp.ts";
import { loadConfig } from "./config.ts";
import type { Host } from "./host.ts";

export interface WhatsAppBridgeOptions {
  host: Pick<Host, "subscribe" | "stateOf">;
  send(text: string): Promise<void>;
  /** Pause between two messages: WhatsApp watches for bursts. */
  spacingMs?: number;
  onError?(e: Error): void;
}

/**
 * The team on the founder's WhatsApp: the same real events as Discord, written in the founder's own
 * chat, each signed by the agent concerned. One message at a time, spaced; errors never reach the engine.
 */
export class WhatsAppBridge {
  private readonly options: WhatsAppBridgeOptions & { spacingMs: number };
  private queue: Promise<void> = Promise.resolve();
  private off: (() => void) | undefined;

  constructor(options: WhatsAppBridgeOptions) {
    this.options = { spacingMs: 3_000, ...options };
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

  idle(): Promise<void> {
    return this.queue;
  }

  private async handle(event: StoredEvent): Promise<void> {
    const state = this.options.host.stateOf(event.companyId);
    if (!state?.company) return;
    for (const m of chatFor(state, event)) {
      await this.options.send(whatsappText(state.company.name, m.as, m.text));
      await new Promise((r) => setTimeout(r, this.options.spacingMs));
    }
  }
}

/** "*Hugo* · Legal · Lumen" then the message, in WhatsApp's own formatting (*bold*). */
export function whatsappText(company: string, as: { name: string; role: Parameters<typeof role>[0] }, text: string): string {
  return `*${as.name}* · ${role(as.role).title} · ${company}\n${text.replace(/\*\*(.+?)\*\*/g, "*$1*")}`;
}

/** Starts the bridge when the founder linked WhatsApp, from the process that runs the companies. */
export function startWhatsApp(host: WhatsAppBridgeOptions["host"], dir: string, onError?: (e: Error) => void, run: WacliRun = runWacli): (() => void) | undefined {
  const phone = loadConfig(dir).whatsapp?.phone;
  if (!phone) return undefined;
  const bridge = new WhatsAppBridge({ host, send: (text) => sendWhatsApp(dir, phone, text, run), ...(onError ? { onError } : {}) });
  bridge.start();
  return () => bridge.stop();
}

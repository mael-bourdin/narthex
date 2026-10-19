import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { emptyState, type Agent, type Task } from "@narthex/core";
import { AnthropicRuntime, creditsFor, type WorkContext } from "../src/index.ts";

const agent: Agent = { id: "lea", name: "Léa", role: "recherche", hiredAt: 0, status: "working", skill: { success: 0, failure: 0 }, autonomy: 1 };
const task: Task = { id: "t", agentId: "lea", title: "Étude", why: "Savoir", kind: "internal", status: "running", createdAt: 0, scheduledAt: 0 };

describe("cost of a turn", () => {
  it("prices cache reads far below fresh input, and cache writes a bit above", () => {
    const fresh = creditsFor("claude-opus-5-5", { input_tokens: 100_000, output_tokens: 0 });
    const read = creditsFor("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000 });
    const write = creditsFor("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100_000, cache_creation: { ephemeral_5m_input_tokens: 100_000, ephemeral_1h_input_tokens: 0 } });
    expect(fresh).toBe(40);
    expect(read).toBe(2);
    expect(write).toBe(50);
  });
});

describe("caching the conversation", () => {
  it("asks the API to cache the growing conversation on every turn", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            calls.push(params);
            return { finalMessage: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "Fini." }] }) };
          },
        },
      },
    } as unknown as Anthropic;
    const spent: number[] = [];
    const ctx = {
      state: emptyState(),
      agent,
      task,
      now: 0,
      signal: new AbortController().signal,
      progress: () => {},
      plan: () => null,
      recruit: () => null,
      spend: (u: { credits: number }) => spent.push(u.credits),
    } as unknown as WorkContext;
    await new AnthropicRuntime({ client }).run(ctx);
    expect(calls[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(spent).toHaveLength(1);
  });
});

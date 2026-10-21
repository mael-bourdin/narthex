import { role, type FirstLook } from "@narthex/core";
import type { AgentRuntime, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

/**
 * Offline, deterministic agents. They let anyone try Narthex without an API key,
 * keep the tests free, and give the UI something real to show while it is being built.
 * They never pretend to be real work: every deliverable says it is a simulation.
 */
export class SimulationRuntime implements AgentRuntime {
  readonly name = "simulation" as const;

  private readonly delayMs: number;

  constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  async firstLook(): Promise<FirstLook> {
    return {
      reaction: "I really like the idea.",
      findings: [
        { text: "Hundreds of craftspeople already sell something similar in France", source: "Company registry (example)" },
        { text: "Customers mostly buy to give as a gift", source: "Customer reviews (example)" },
        { text: "Prices sit within a narrow range", source: "Online shops (example)" },
        { text: "To start: micro-entreprise or SASU", source: "Légifrance (example)" },
      ],
      simulated: true,
      team: [
        { role: "recherche", why: "Before creating anything, we need to know the market." },
        { role: "juridique", why: "We need to check the name and the activity, then register the company." },
      ],
      later: [
        { role: "prospection", why: "To find the first customers." },
        { role: "redaction", why: "For the website and the posts." },
      ],
    };
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const { task, agent, state } = ctx;
    const company = state.company;
    ctx.progress("Getting to work…");
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (ctx.signal.aborted) throw new Error("Cancelled");

    const script = SCRIPTS[task.tag ?? ""];
    const idea = company?.idea ?? "your idea";
    const body = script
      ? script.body(idea, company?.name ?? "your company")
      : `Simulated work for "${task.title}".\n\nIn real mode, ${agent.name} would do this work with Claude and cite their sources.`;

    for (const f of script?.followUps ?? []) ctx.plan(f);

    const effort = role(agent.role).effort;
    return {
      post: script?.post ?? `Done: ${lower(task.title)}.`,
      deliverable: {
        title: task.title,
        summary: script?.summary ?? "Demo deliverable (simulation mode).",
        body: `> Simulation mode: example content, no real research.\n\n${body}`,
        sources: [],
      },
      ...(task.tag === "plan" ? { memory: `${company?.name} — ${idea}. Target launch: in six weeks.` } : {}),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: effort === "high" ? 40 : effort === "medium" ? 15 : 5 },
    };
  }
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

interface Script {
  post: string;
  summary: string;
  body: (idea: string, name: string) => string;
  followUps?: FollowUp[];
}

const SCRIPTS: Record<string, Script> = {
  plan: {
    post: "I've written the company sheet and the plan for the first 30 days. Léa is starting the market study, Hugo is checking the name.",
    summary: "Company sheet, goals, 30-day plan.",
    body: (idea, name) =>
      `# ${name}\n\n**The idea:** ${idea}\n\n## The first 30 days\n1. Market study (Léa)\n2. Name and activity checked (Hugo)\n3. Registering the company\n4. First prospects and website\n`,
  },
  "market-study": {
    post: "The market study is ready. There is room, especially for gifts. I've attached the key points for you.",
    summary: "Market size, customers, competitors, average prices.",
    body: (idea) =>
      `# Market study\n\n**Idea studied:** ${idea}\n\n| Point | What we take away |\n|---|---|\n| Customers | Mostly buy to give as a gift |\n| Competitors | Many, little differentiated |\n| Prices | In the upper middle of the market |\n`,
  },
  prospects: {
    post: "I've found 50 businesses to write to. I'm preparing a message for each; the send is planned for tomorrow, and you can cancel it until then.",
    summary: "50 qualified prospects, with the reason for each pick.",
    body: () => "# Prospects\n\n50 local businesses, ranked by likelihood of replying.\n",
    followUps: [
      { title: "Send the outreach messages", why: "To get the first meetings before the launch.", kind: "external", tag: "outreach", inHours: 20 },
    ],
  },
  outreach: {
    post: "The messages are ready (example, simulation mode). Nothing has gone out: sending them is up to you.",
    summary: "Messages ready to send, replies to follow up.",
    body: () => "# Outreach\n\nPersonalised messages ready to send. Follow-up planned in 4 days.\n",
  },
};

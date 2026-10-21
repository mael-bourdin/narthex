import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { emptyState, ROLES, type Agent, type Task } from "@narthex/core";
import { AnthropicRuntime, searchCompanies, type WorkContext } from "../src/index.ts";

const RAW = {
  total_results: 2,
  results: [
    {
      siren: "883542003",
      nom_complet: "MAISON LUMEN",
      date_creation: "2026-09-10",
      etat_administratif: "A",
      activite_principale: "47.91B",
      nature_juridique: "1000",
      dirigeants: [{ nom: "DUPONT", prenoms: "Jean" }],
      siege: { libelle_commune: "PARIS", code_postal: "75007", liste_enseignes: ["LUMEN"] },
    },
    { siren: "123456789", nom_complet: "BOULANGERIE X", date_creation: "2017-08-24", etat_administratif: "C", activite_principale: "10.71C", siege: { libelle_commune: "BEZOUCE", code_postal: "30320" } },
  ],
};

describe("API Recherche d'entreprises", () => {
  it("asks the public API and keeps what a company sheet needs, no personal data", async () => {
    const urls: string[] = [];
    const out = await searchCompanies({ q: "maison lumen", code_postal: "75007" }, { fetch: async (u) => (urls.push(u), { ok: true, status: 200, json: async () => RAW }) });
    const u = new URL(urls[0]!);
    expect(u.origin + u.pathname).toBe("https://recherche-entreprises.api.gouv.fr/search");
    expect(u.searchParams.get("q")).toBe("maison lumen");
    expect(u.searchParams.get("code_postal")).toBe("75007");
    expect(out.total).toBe(2);
    expect(out.results[0]).toEqual({
      siren: "883542003",
      nom: "MAISON LUMEN",
      enseignes: ["LUMEN"],
      activite: "47.91B",
      creation: "2026-09-10",
      active: true,
      commune: "PARIS",
      codePostal: "75007",
      fiche: "https://annuaire-entreprises.data.gouv.fr/entreprise/883542003",
    });
    expect(JSON.stringify(out)).not.toContain("DUPONT");
    expect(out.results[1]!.active).toBe(false);
  });

  it("refuses an empty search and says when the service is down", async () => {
    await expect(searchCompanies({}, { fetch: async () => ({ ok: true, status: 200, json: async () => RAW }) })).rejects.toThrow(/criterion/);
    await expect(searchCompanies({ q: "x" }, { fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) })).rejects.toThrow(/429/);
  });

  it("is a tool for the roles that check names and find clients", () => {
    const withTool = ROLES.filter((r) => r.tools.includes("search_companies")).map((r) => r.id);
    expect(withTool).toEqual(expect.arrayContaining(["cofondateur", "recherche", "juridique", "prospection"]));
  });

  it("runs as an agent tool, and its company sheets count as pages read", async () => {
    let turn = 0;
    const results: unknown[] = [];
    const client = {
      beta: {
        messages: {
          stream: (p: { tools: { name: string }[]; messages: { role: string; content: unknown }[] }) => {
            const last = p.messages.at(-1);
            if (last?.role === "user" && Array.isArray(last.content)) results.push(...last.content);
            const content =
              turn++ === 0
                ? [{ type: "tool_use", id: "c", name: "search_companies", input: { q: "maison lumen", code_postal: null, departement: null, activite_principale: null } }]
                : [{ type: "text", text: "Fait." }];
            return { finalMessage: async () => ({ stop_reason: turn === 1 ? "tool_use" : "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, content }) };
          },
        },
      },
    } as unknown as Anthropic;
    const agent: Agent = { id: "h", name: "Hugo", role: "juridique", hiredAt: 0, status: "working", skill: { success: 0, failure: 0 }, autonomy: 1 };
    const task: Task = { id: "t", agentId: "h", title: "Vérifier le nom", why: "", kind: "internal", status: "running", createdAt: 0, scheduledAt: 0 };
    const ctx = { state: emptyState(), agent, task, now: 0, signal: new AbortController().signal, progress() {}, plan: () => null, recruit: () => null, spend() {} } as unknown as WorkContext;
    const out = await new AnthropicRuntime({ client, companies: async () => ({ total: 1, results: [{ siren: "883542003", nom: "MAISON LUMEN", enseignes: [], activite: "47.91B", creation: "2026-09-10", active: true, commune: "PARIS", codePostal: "75007", fiche: "https://annuaire-entreprises.data.gouv.fr/entreprise/883542003" }] }) }).run(ctx);
    expect(JSON.stringify(results)).toContain("883542003");
    expect(out.consulted).toContain("https://annuaire-entreprises.data.gouv.fr/entreprise/883542003");
  });
});

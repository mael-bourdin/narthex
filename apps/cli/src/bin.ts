import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ALWAYS_ASK, deliverableMarkdown, fmt, OFFICES, ROLES, STAGE_LABEL, type CompanyState, type LegalForm } from "@narthex/core";
import {
  archiveCompany,
  chooseRuntime,
  InProcessClient,
  isAlive,
  loadConfig,
  openEngine,
  startDiscord,
  startWhatsApp,
  checkDiscordToken,
  fetchLeaderboard,
  leaderboardSettings,
  LeaderboardPublisher,
  withdrawFromLeaderboard,
  saveConfig,
  saveProviderKey,
  verifyKey,
  PROVIDER_LABEL,
  serve,
  SocketClient,
  socketPath,
  dataDir,
  DEFAULT_MODEL,
  type Client,
  type Config,
} from "@narthex/engine";
import * as render from "./render.ts";
import { runSeuil } from "./seuil.ts";
import { whatsappCommand } from "./whatsapp.ts";
import { bold, clean, dim, red, rule, violet } from "./style.ts";

const HELP = `${bold("narthex")} — a team of AI agents that founds and runs your company.

${bold("Start")}
  narthex init                      First launch: your key, your idea, your team
  narthex start                     Put the team to work (and watch the feed live)

${bold("Look")}
  narthex [feed]                    The feed: what the team did, what is waiting for you
  narthex team                      Who is doing what right now
  narthex calendar [--week]         Today's or this week's tasks  [--agent Samir]
  narthex obligations               Legal obligations, yours first
  narthex log                       Every action, in order
  narthex hires                     Who joined, who is coming and when
  narthex agent <name>              A teammate's sheet
  narthex company [section] [page]  Overview, finances, sales, marketing, legal
  narthex spend                     AI spend, per teammate and per day
  narthex tables                    Every table the team produced
  narthex data [--week]             Company figures: sales, spend, tasks, team
  narthex memory                    What the team knows (dated facts, from deliverables)
  narthex forget <id> --yes         Erase a fact from memory and from the log (for good)
  narthex why "<question>"          Find a decision and its reason in the log
  narthex companies                 Your companies (all of them run; “init” adds one)
  narthex switch <name>             Show another company in the CLI
  narthex leaderboard               The ranking of companies on the hosted version
  narthex deliverable <id|last>     Read a deliverable (--file x.md to save it)

${bold("Act")} (only what the law reserves to you, or to stop something)
  narthex done <id> [--form SASU]   Say you completed an obligation
  narthex cancel <id>               Cancel a planned action
  narthex sale [amount] [--note "…"]  Record a sale (the first one opens the “operating” stage)
  narthex retry <id>                Restart an obligation stuck after several failures
  narthex pause | resume            Pause the team
  narthex whatsapp [off | relink]   The team writes to you on WhatsApp (through wacli, unofficial)
  narthex discord [token | server <id> | off]  The team writes on your Discord (a channel per team)
  narthex leaderboard join | leave | revenue <on|off>  Your place in the ranking (hosted version)
  narthex reset [--yes]             Archive the company and see the first launch again

${bold("Settings")}
  narthex config                    Show the configuration
  narthex config key                Save your API key: Anthropic, OpenAI or OpenRouter (every model)
  narthex config api <url> [key]    An OpenAI-compatible API (Mistral, Ollama, LM Studio…)
  narthex config level <light|standard|deep> <model>  The model for each task level
  narthex config mode <auto|simulation|anthropic>
  narthex config model <id>         One model for everyone
  narthex config model <role> <id> One agent's model (e.g. video claude-haiku-5-5)
  narthex config delay <hours>      How long you can cancel an external action
  narthex config ask <topic>        Reserve or release a topic (prix, publicite-payante, presse, contrat-client)
  narthex config budget <dollars>   Maximum AI spend per day (default $3)
  narthex config task-budget <dollars>  Maximum AI spend per task (default $1.50)
  narthex profile [--name] [--first-name] [--city]  See or change the profile
  narthex export                    Write the company to a JSON file
  narthex advance <hours>           Simulation: move the clock forward

${bold("Options")}  --dir <path>  --json  --help
Without an API key, the team prepares everything and waits for your key: nothing is made up.
French commands still work (lancer, fil, equipe, valider…).`;

const { values: raw, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    name: { type: "string" },
    idea: { type: "string" },
    "first-name": { type: "string" },
    city: { type: "string" },
    file: { type: "string" },
    "no-start": { type: "boolean" },
    week: { type: "boolean" },
    agent: { type: "string" },
    form: { type: "string" },
    count: { type: "string", short: "n" },
    yes: { type: "boolean" },
    note: { type: "string" },
    // French spellings, still accepted.
    dossier: { type: "string" },
    aide: { type: "boolean" },
    nom: { type: "string" },
    idee: { type: "string" },
    prenom: { type: "string" },
    ville: { type: "string" },
    fichier: { type: "string" },
    "sans-lancer": { type: "boolean" },
    semaine: { type: "boolean" },
    forme: { type: "string" },
    nombre: { type: "string" },
    oui: { type: "boolean" },
  },
});
const opts = {
  dir: raw.dir ?? raw.dossier,
  json: raw.json,
  help: raw.help ?? raw.aide,
  name: raw.name ?? raw.nom,
  idea: raw.idea ?? raw.idee,
  firstName: raw["first-name"] ?? raw.prenom,
  city: raw.city ?? raw.ville,
  file: raw.file ?? raw.fichier,
  noStart: raw["no-start"] ?? raw["sans-lancer"],
  week: raw.week ?? raw.semaine,
  agent: raw.agent,
  form: raw.form ?? raw.forme,
  count: raw.count ?? raw.nombre,
  yes: raw.yes ?? raw.oui,
  note: raw.note,
};

/** The French commands of the first versions, still understood. */
const ALIASES: Record<string, string> = {
  lancer: "start",
  run: "start",
  fil: "feed",
  equipe: "team",
  calendrier: "calendar",
  journal: "log",
  recrutements: "hires",
  entreprise: "company",
  depense: "spend",
  dépense: "spend",
  tableaux: "tables",
  memoire: "memory",
  mémoire: "memory",
  oublier: "forget",
  pourquoi: "why",
  entreprises: "companies",
  choisir: "switch",
  classement: "leaderboard",
  livrable: "deliverable",
  valider: "done",
  annuler: "cancel",
  vente: "sale",
  reessayer: "retry",
  reprendre: "resume",
  recommencer: "reset",
  profil: "profile",
  exporter: "export",
  avancer: "advance",
  statut: "status",
  aide: "help",
};

const dir = opts.dir ?? dataDir();
const [given = "feed", ...args] = positionals;
const command = ALIASES[given] ?? given;

async function main(): Promise<void> {
  if (opts.help || command === "help") return print(HELP);
  switch (command) {
    case "init":
      return init();
    case "start":
      return start();
    case "config":
      return config();
    case "reset":
      return reset();
    case "discord":
      return discord();
    case "leaderboard":
      return leaderboard();
    case "whatsapp":
      return whatsappCommand(dir, args[0] === "relier" ? "relink" : args[0]);
  }
  await withClient(async (client) => {
    if (command === "companies" || command === "switch") return companies(client);
    const state = await client.call("state.get", {});
    if (!state) {
      print(`No company here yet. Start with ${bold("narthex init")}.`);
      return;
    }
    const status = await client.call("engine.status", {});
    if (opts.json && ["feed", "team", "calendar", "obligations"].includes(command)) return print(JSON.stringify(state, null, 2));
    switch (command) {
      case "feed":
        return print(render.fil(state, status, Number(opts.count ?? 15)));
      case "team":
        return print(render.equipe(state, status.now));
      case "calendar": {
        const agent = opts.agent ? Object.values(state.agents).find((a) => a.name.toLowerCase() === opts.agent!.toLowerCase()) : undefined;
        if (opts.agent && !agent) throw new Error(`Nobody called ${opts.agent} in the team.`);
        return print(render.calendrier(state, status.now, opts.week ? "semaine" : "jour", agent?.id));
      }
      case "obligations":
        return print(render.obligations(state));
      case "company":
        return print(render.entreprise(state, status.now, args[0], args[1]));
      case "spend":
        return print(render.depense(state, await client.call("events.read", {})));
      case "tables":
        return print(render.tableaux(state));
      case "profile": {
        if (opts.name || opts.firstName || opts.city) {
          const next = await client.call("company.update", { ...(opts.name ? { name: opts.name } : {}), ...(opts.firstName ? { founderName: opts.firstName } : {}), ...(opts.city ? { city: opts.city } : {}) });
          return print(`Saved: ${next.company!.name}, ${next.company!.founder.name}${next.company!.city ? `, ${next.company!.city}` : ""}.`);
        }
        const c = state.company!;
        return print(`${bold(c.name)}\n${c.founder.name}${c.city ? ` · ${c.city}` : ""} · ${c.legalForm ?? "legal form to choose"}`);
      }
      case "export": {
        const events = await client.call("events.read", {});
        const file = opts.file ?? `${state.company!.name.replace(/[^\p{L}\p{N}-]+/gu, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
        writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), company: state.company, events }, null, 2));
        return print(`Exported: ${file}`);
      }
      case "hires":
        return print(render.recrutementsView(state));
      case "agent": {
        const a = Object.values(state.agents).find((x) => x.name.toLowerCase() === (args[0] ?? "").toLowerCase());
        if (!a) throw new Error(`Nobody called ${args[0] ?? "that"} in the team.`);
        return print(render.agentView(state, a.id, status.now));
      }
      case "log": {
        const events = await client.call("events.read", {});
        const n = Number(opts.count ?? 40);
        return print(opts.json ? JSON.stringify(events, null, 2) : render.journal(state, events, n));
      }
      case "data": {
        const events = await client.call("events.read", {});
        return print(render.data(state, events, status.now, opts.week ? 7 : 30));
      }
      case "memory":
        return print(opts.json ? JSON.stringify(Object.values(state.facts), null, 2) : render.memoire(state, status.now));
      case "forget": {
        const f = byPrefix(Object.values(state.facts), args[0], "fact");
        if (!opts.yes) return print(`${bold("Forget:")} ${clean(f.text)}\nThis is for good: erased from memory and from the log. Confirm with --yes.`);
        await client.call("fact.forget", { factId: f.id });
        return print(`${bold("Forgotten.")} Erased from memory and from the log.`);
      }
      case "why": {
        const question = args.join(" ").trim();
        if (!question) throw new Error("Ask your question: narthex why \"consignment\"");
        return print(render.pourquoi(state, question));
      }
      case "deliverable": {
        const all = Object.values(state.deliverables).sort((a, b) => b.createdAt - a.createdAt);
        const d = !args[0] || args[0] === "last" || args[0] === "dernier" ? all[0] : all.find((x) => x.id.startsWith(args[0]!));
        if (!d) throw new Error("No such deliverable.");
        if (opts.file) {
          writeFileSync(opts.file, deliverableMarkdown(state, d));
          return print(`${bold("Saved.")} ${opts.file}`);
        }
        return print(opts.json ? JSON.stringify(d, null, 2) : render.livrable(state, d));
      }
      case "done": {
        const o = byPrefix(Object.values(state.obligations), args[0], "obligation");
        const next = await client.call("obligation.fulfill", { obligationId: o.id, ...(opts.form ? { legalForm: legalForm(opts.form) } : {}) });
        print(`${bold("Noted.")} ${o.title}.`);
        return afterAction(next, status.passive);
      }
      case "sale": {
        const amountCents = args[0] ? fmt.parseDollars(args[0]) : undefined;
        if (amountCents !== undefined && !(amountCents >= 0)) throw new Error("Unreadable amount: narthex sale 39.90");
        const next = await client.call("sale.record", { ...(amountCents !== undefined ? { amountCents } : {}), ...(opts.note ? { note: opts.note } : {}) });
        print(`${bold("Sale recorded.")}${amountCents !== undefined ? ` ${fmt.euros(amountCents)}` : ""}`);
        return afterAction(next, status.passive);
      }
      case "retry": {
        const o = byPrefix(Object.values(state.obligations), args[0], "obligation");
        const next = await client.call("obligation.retry", { obligationId: o.id });
        print(`${bold("Back on it.")} The team takes up “${clean(o.title)}” again.`);
        return afterAction(next, status.passive);
      }
      case "cancel": {
        const t = byPrefix(Object.values(state.tasks), args[0], "task");
        await client.call("task.cancel", { taskId: t.id });
        return print(`Cancelled: ${clean(t.title)}.`);
      }
      case "pause":
        await client.call("company.pause", {});
        return print("The team is paused. Obligations stay on the list. Resume with: narthex resume");
      case "resume":
        await client.call("company.resume", {});
        return print("The team is back at work.");
      case "advance": {
        const hours = Number(args[0] ?? 24);
        if (!Number.isFinite(hours) || hours <= 0) throw new Error("Give a number of hours, for example: narthex advance 24");
        const s = await client.call("clock.advance", { hours });
        return print(`Clock moved forward ${hours} h.${s.passive ? " The team will work at the next “narthex start”." : ""}`);
      }
      case "status":
        return print(JSON.stringify(status, null, 2));
      default:
        throw new Error(`Unknown command: ${given}. See narthex --help`);
    }
  });
}

function afterAction(_state: CompanyState, passive: boolean): void {
  if (passive) print(dim("The team will take care of it at the next “narthex start”."));
}

// ---------- Connecting ----------

/** Talks to a running `narthex lancer` when there is one, else opens the company read-and-record only. */
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const socket = await SocketClient.connect(socketPath(dir));
  if (socket) {
    try {
      return await fn(socket);
    } finally {
      await socket.close();
    }
  }
  const { engine } = openEngine({ dir, passive: true });
  try {
    return await fn(new InProcessClient(engine));
  } finally {
    await engine.close();
  }
}

// ---------- init ----------

async function init(): Promise<void> {
  await runSeuil({
    dir,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    given: { ...(opts.idea ? { idee: opts.idea } : {}), ...(opts.firstName ? { prenom: opts.firstName } : {}), ...(opts.name ? { nom: opts.name } : {}) },
  });
  if (opts.noStart || (await isAlive(socketPath(dir)))) return print(`\n  Start the team whenever you like: ${bold("narthex start")}`);
  print("");
  return start();
}

// ---------- discord ----------

async function discord(): Promise<void> {
  const current = loadConfig(dir);
  const [first, second] = args;
  if (first === "off") {
    const { discord: _gone, ...rest } = current;
    saveConfig(dir, rest);
    return print("Discord disconnected. Messages already posted stay on your server.");
  }
  if (first === "server" || first === "serveur") {
    if (!current.discord?.token) throw new Error("Give the bot token first: narthex discord <token>");
    const check = await checkDiscordToken(current.discord.token);
    if (!check.ok) throw new Error(check.message);
    const guild = check.guilds.find((g) => g.id === second || g.name.toLowerCase() === (second ?? "").toLowerCase());
    if (!guild) throw new Error(`Server not found. The bot is on: ${check.guilds.map((g) => `${g.name} (${g.id})`).join(", ") || "no server, invite it first"}.`);
    saveConfig(dir, { ...current, discord: { token: current.discord.token, guildId: guild.id, guildName: guild.name } });
    return print(`${bold("Connected.")} The team will write on ${clean(guild.name)} at the next “narthex start”.`);
  }
  if (!first) {
    if (!current.discord?.token) return print(`No Discord. Create a bot (discord.com/developers · New Application · Bot), invite it to your server, then: ${bold("narthex discord <token>")}`);
    return print(current.discord.guildId ? `Discord: ${clean(current.discord.guildName ?? current.discord.guildId)}.` : `Token saved. Choose the server: ${bold("narthex discord server <name or id>")}`);
  }
  const check = await checkDiscordToken(first);
  if (!check.ok) throw new Error(check.message);
  const only = check.guilds.length === 1 ? check.guilds[0]! : undefined;
  saveConfig(dir, { ...current, discord: { token: first, ...(only ? { guildId: only.id, guildName: only.name } : {}) } });
  if (only) return print(`${bold("Connected.")} The bot ${clean(check.bot)} will write on ${clean(only.name)}.`);
  print(`Bot ${clean(check.bot)} recognised. Choose the server:`);
  for (const g of check.guilds) print(`  ${clean(g.name)} ${dim(g.id)}`);
  print(check.guilds.length ? `→ ${bold("narthex discord server <name or id>")}` : "It is on no server: invite it first (OAuth2 · URL Generator · bot, with Manage Channels, Manage Webhooks, Send Messages, Add Reactions, Create Public Threads).");
}

// ---------- leaderboard ----------

async function leaderboard(): Promise<void> {
  const current = loadConfig(dir);
  const settings = leaderboardSettings(current);
  const [action, value] = args;
  if (action) {
    if (settings.edition !== "hosted") throw new Error("You are on the open-source version: your companies stay with you and never appear in the ranking.");
    if (!settings.token) throw new Error("This instance has no ranking token yet.");
    const leaderboard = { ...current.leaderboard };
    const act = ({ rejoindre: "join", quitter: "leave", montant: "revenue" } as Record<string, string>)[action] ?? action;
    const on = value === "on" || value === "oui" ? true : value === "off" || value === "non" ? false : undefined;
    if (act === "join") leaderboard.share = true;
    else if (act === "leave") leaderboard.share = false;
    else if (act === "revenue" && on !== undefined) leaderboard.showRevenue = on;
    else throw new Error("Usage: narthex leaderboard join | leave | revenue <on|off>");
    saveConfig(dir, { ...current, leaderboard });
    if (act === "leave") {
      const ids = await withClient((client) => client.call("companies.list", {})).then((l) => l.map((c) => c.id));
      const gone = await Promise.all(ids.map((id) => withdrawFromLeaderboard(settings, id)));
      return print(gone.every(Boolean) ? "Your companies left the ranking." : "Noted. The ranking is not answering: your companies will leave it as soon as it does (run “narthex leaderboard leave” again).");
    }
    if (act === "revenue" && !leaderboard.showRevenue && settings.share) {
      // The exact amount must not stay visible: take the entries down now; the team republishes them with a band.
      const ids = await withClient((client) => client.call("companies.list", {})).then((l) => l.map((c) => c.id));
      const done = await Promise.all(ids.map((id) => withdrawFromLeaderboard(settings, id)));
      return print(done.every(Boolean) ? "The exact amount is gone. Your companies come back with a band as soon as the team runs." : "Noted, but the ranking is not answering: run “narthex leaderboard revenue off” again to take the amount down.");
    }
    if (act === "join") return print(`${bold("Noted.")} Your companies will appear in the ranking as soon as the team runs (“narthex start”). Name, city, your first name, stage, office, sales: never your idea nor your documents.`);
    return print(leaderboard.showRevenue ? "Your exact revenue will be shown." : "Only a revenue band will be shown.");
  }
  if (!settings.url) return print("The ranking is not online yet. It will bring together the companies of Narthex's hosted version.");
  const entries = await fetchLeaderboard(settings.url);
  if (opts.json) return print(JSON.stringify(entries, null, 2));
  if (!entries.length) return print("Nobody is in it yet.");
  const mine = new Set(await withClient((client) => client.call("companies.list", {})).then((l) => l.map((c) => c.id)).catch(() => [] as string[]));
  print(bold("Leaderboard"));
  for (const { rank, entry: e } of entries) {
    const line = `${String(rank).padStart(3)}  ${clean(e.name)} ${dim(`· ${[e.city && clean(e.city), STAGE_LABEL[e.stage], OFFICES[e.office]?.name, e.revenue !== undefined ? fmt.euros(e.revenue) : e.revenueBand, `${e.sales} sale${e.sales === 1 ? "" : "s"}`, `${e.days} d`].filter(Boolean).join(" · ")}`)}`;
    print(mine.has(e.companyId) ? violet(line) : line);
  }
  if (settings.edition !== "hosted") print(dim("\nYou are on the open-source version: your companies are not in it, your data stays with you."));
}

// ---------- companies ----------

async function companies(client: Client): Promise<void> {
  const list = await client.call("companies.list", {});
  if (command === "switch") {
    const wanted = args.join(" ").trim().toLowerCase();
    const found = list.filter((c) => c.id === wanted || c.name.toLowerCase().includes(wanted));
    if (!wanted || found.length !== 1) throw new Error(found.length > 1 ? "Several companies match: give more of the name." : "No company matches. List them with “narthex companies”.");
    await client.call("company.select", { companyId: found[0]!.id });
    return print(`${bold(clean(found[0]!.name))} is shown. The others keep running.`);
  }
  if (list.length === 0) return print(`No company yet. Start with ${bold("narthex init")}.`);
  print(bold("Your companies"));
  for (const c of list) print(`${c.active ? violet("●") : dim("○")} ${clean(c.name)} ${dim(`· ${STAGE_LABEL[c.stage]} · AI spend ${fmt.dollars(c.spent)}`)}`);
  print(dim(`\nAll of them run. Switch: narthex switch <name> · add one: narthex init`));
}

// ---------- reset ----------

async function reset(): Promise<void> {
  if (await isAlive(socketPath(dir))) throw new Error("The team is running (“narthex start”): stop it first.");
  if (!opts.yes) {
    if (!process.stdin.isTTY) throw new Error("Add --yes to confirm.");
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("All your companies will be archived (nothing is deleted) and the first launch will start over. To just add another one: narthex init. Go ahead? (y/n) ")).trim().toLowerCase();
    rl.close();
    if (!answer.startsWith("y") && !answer.startsWith("o")) return print("All right, nothing changed.");
  }
  const archived = archiveCompany(dir);
  print(archived ? `Done. The old company is stored in ${archived}.` : "There was no company here.");
  print(`The first launch is waiting: ${bold("narthex init")}.`);
}

// ---------- start ----------

async function start(): Promise<void> {
  if (await isAlive(socketPath(dir))) {
    print(`The team is already working in another terminal. Look at the feed: ${bold("narthex feed")}`);
    return;
  }
  const { engine } = openEngine({ dir });
  if (!engine.getState().company) {
    await engine.close();
    print(`No company here yet. Start with ${bold("narthex init")}.`);
    return;
  }
  const server = await serve(engine, socketPath(dir));
  print(render.fil(engine.getState(), engine.status(), 8));
  if (["anthropic", "openrouter", "openai", "compatible"].includes(engine.status().runtime)) {
    print(dim(`Real agents with your key (${PROVIDER_LABEL[engine.status().runtime as "anthropic"] ?? engine.status().runtime}). Each task costs dollars on your account; the AI spend shows at the top of the feed.`));
  }
  if (engine.status().runtime === "claude-code") print(dim("Development: the agents go through your Claude Code, on your claude.ai subscription. No API key, no dollar spent."));
  print(rule());
  print(dim("Live. Ctrl+C to stop (the team finishes what it started)."));

  engine.subscribe((e) => {
    const s = engine.getState();
    if (e.type === "post.published") {
      const d = e.post.deliverableId ? s.deliverables[e.post.deliverableId] : undefined;
      print(render.postBlock(s, e.post.agentId, e.post.at, e.post.text, engine.now(), d));
    } else if (e.type === "task.started") {
      const t = s.tasks[e.taskId];
      if (t) print(dim(`  ${s.agents[t.agentId]?.name} starts: ${clean(t.title)}`));
    }
  });
  engine.start();
  const stopDiscord = startDiscord(engine, dir, (e) => print(dim(`  Discord: ${e.message}`)));
  if (stopDiscord) print(dim(`Discord: the team also writes on ${loadConfig(dir).discord?.guildName ?? "your server"}.`));
  const stopWhatsApp = startWhatsApp(engine, dir, (e) => print(dim(`  WhatsApp: ${e.message}`)));
  if (stopWhatsApp) print(dim(`WhatsApp: the team also writes to you at +${loadConfig(dir).whatsapp?.phone}.`));
  const publisher = new LeaderboardPublisher({ host: engine, settings: () => leaderboardSettings(loadConfig(dir)) });
  publisher.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      engine.abortAll();
      process.exit(130);
    }
    stopping = true;
    stopDiscord?.();
    stopWhatsApp?.();
    publisher.stop();
    print(dim("\nWaiting for the team to finish what it started… (Ctrl+C again to cut right away)"));
    server.close();
    await engine.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  await new Promise(() => {});
}

// ---------- config ----------

async function config(): Promise<void> {
  const current = loadConfig(dir);
  const [given, value] = args;
  const key = ({ cle: "key", clé: "key", niveau: "level", modele: "model", modèle: "model", demander: "ask", vitesse: "speed", "budget-tache": "task-budget", delai: "delay", délai: "delay" } as Record<string, string>)[given ?? ""] ?? given;
  const next: Config = { ...current };
  switch (key) {
    case undefined: {
      const shown = {
        ...current,
        ...(current.anthropicApiKey ? { anthropicApiKey: `${current.anthropicApiKey.slice(0, 10)}…` } : {}),
        ...(current.keys ? { keys: Object.fromEntries(Object.entries(current.keys).map(([p, k]) => [p, `${String(k).slice(0, 8)}…`])) } : {}),
        ...(current.discord ? { discord: { server: current.discord.guildName ?? current.discord.guildId ?? "to choose", token: "hidden" } } : {}),
      };
      print(`${bold("Folder")} ${dir}\n${bold("Mode")} ${chooseRuntime(current)}\n${JSON.stringify(shown, null, 2)}`);
      return;
    }
    case "key": {
      const k = value ?? (await readSecret("API key (Anthropic sk-ant-…, OpenAI sk-…, OpenRouter sk-or-…) › "));
      const check = await verifyKey(k);
      if (!check.ok) throw new Error(check.message);
      saveProviderKey(dir, check.provider, check.key);
      return print(`${PROVIDER_LABEL[check.provider]} key saved. The team uses it from the next “narthex start”.`);
    }
    case "api": {
      // An OpenAI-compatible API: narthex config api <url> <key> (Mistral, Ollama, LM Studio…).
      const key = args[2] ?? "local";
      if (!value || !/^https?:\/\//.test(value)) throw new Error("Usage: narthex config api <url, e.g. http://localhost:11434/v1> [key]");
      saveProviderKey(dir, "compatible", key, value);
      return print(`Compatible API saved (${clean(value)}). Choose its models: narthex config level standard <id>.`);
    }
    case "level": {
      const level = ({ light: "light", standard: "standard", deep: "deep", leger: "light", léger: "light", normal: "standard", approfondi: "deep" } as const)[value as "light"];
      const model = args[2];
      if (!level || !model) throw new Error("Usage: narthex config level <light|standard|deep> <model>");
      next.levels = { ...next.levels, [level]: model };
      break;
    }
    case "mode":
      if (value === "auto") delete next.runtime;
      else if (value === "simulation" || value === "anthropic") next.runtime = value;
      else throw new Error("Mode: auto, simulation or anthropic.");
      break;
    case "model": {
      if (!value) throw new Error("Give a model id, for example claude-opus-5-5.");
      const perRole = args[2];
      if (perRole) {
        if (!ROLES.some((r) => r.id === value)) throw new Error(`Unknown role: ${value}. Choices: ${ROLES.map((r) => r.id).join(", ")}.`);
        next.models = { ...next.models, [value]: perRole };
        break;
      }
      next.model = value;
      break;
    }
    case "ask": {
      const topic = ALWAYS_ASK.find((t) => t.tag === value);
      if (!topic) throw new Error(`Unknown topic. Choices: ${ALWAYS_ASK.map((t) => t.tag).join(", ")}.`);
      let now: string[] = [];
      await withClient(async (client) => {
        const state = await client.call("state.get", {});
        const current = state?.settings.alwaysAsk ?? [];
        now = current.includes(topic.tag) ? current.filter((t) => t !== topic.tag) : [...current, topic.tag];
        await client.call("settings.update", { patch: { alwaysAsk: now } });
      });
      return print(`${topic.label}: ${now.includes(topic.tag) ? "the team will ask you first" : "the team decides on its own"}.`);
    }
    case "speed":
      next.simulationSpeed = Number(value);
      break;
    case "budget":
    case "task-budget": {
      const credits = fmt.parseDollars(value ?? "");
      if (!Number.isFinite(credits)) throw new Error("Give an amount in dollars, for example 3 or 1.50.");
      const patch = key === "budget" ? { dailyBudgetCredits: credits } : { taskBudgetCredits: credits };
      await withClient(async (client) => {
        await client.call("settings.update", { patch });
      });
      return print(`${key === "budget" ? "Maximum AI spend per day" : "Maximum AI spend per task"}: ${fmt.dollars(credits)}.`);
    }
    case "delay": {
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours < 0) throw new Error("Give a number of hours.");
      await withClient(async (client) => {
        await client.call("settings.update", { patch: { cancelWindowHours: hours } });
      });
      return print(`Cancel window: ${hours} h.`);
    }
    default:
      throw new Error(`Unknown setting: ${given}`);
  }
  saveConfig(dir, next);
  print("Saved. It applies from the next “narthex start”.");
}

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data.trim();
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let secret = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(secret.trim());
      } else if (ch === "\u0003") process.exit(130);
      else if (ch === "\u007f" || ch === "\b") secret = secret.slice(0, -1);
      else secret += ch;
    };
    process.stdin.on("data", onData);
  });
}

// ---------- helpers ----------

function byPrefix<T extends { id: string }>(items: T[], prefix: string | undefined, what: string): T {
  if (!prefix) throw new Error(`Give the ${what}'s id (shown in the feed).`);
  const found = items.filter((i) => i.id === prefix || i.id.startsWith(prefix));
  if (found.length === 0) throw new Error(`No ${what} matches “${prefix}”.`);
  if (found.length > 1) throw new Error(`Several ${what}s match “${prefix}”: give more characters.`);
  return found[0]!;
}

function legalForm(v: string): LegalForm {
  const forms: LegalForm[] = ["SASU", "SAS", "EURL", "SARL", "EI", "micro"];
  const f = forms.find((x) => x.toLowerCase() === v.toLowerCase());
  if (!f) throw new Error(`Unknown legal form: ${v}. Choices: ${forms.join(", ")}.`);
  return f;
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

// node:sqlite still prints an experimental warning on Node 24; it means nothing to a player.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

main().catch((e: unknown) => {
  process.stderr.write(`${red("Error")} ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

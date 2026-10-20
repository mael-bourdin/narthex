import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ALWAYS_ASK, deliverableMarkdown, fmt, ROLES, type CompanyState, type LegalForm } from "@narthex/core";
import {
  archiveCompany,
  chooseRuntime,
  InProcessClient,
  isAlive,
  loadConfig,
  openEngine,
  saveConfig,
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
import { bold, clean, dim, red, rule } from "./style.ts";

const HELP = `${bold("narthex")} — une équipe d'agents IA qui crée et fait tourner ton entreprise.

${bold("Commencer")}
  narthex init                      Le premier lancement : ta clé, ton idée, ton équipe
  narthex lancer                    Fait travailler l'équipe (et affiche le Fil en direct)

${bold("Regarder")}
  narthex [fil]                     Le Fil : ce que l'équipe a fait, ce qui t'attend
  narthex equipe                    Qui fait quoi en ce moment
  narthex calendrier [--semaine]    Les tâches du jour ou de la semaine  [--agent Samir]
  narthex obligations               Les obligations légales, les tiennes en premier
  narthex journal                   Toutes les actions, dans l'ordre
  narthex recrutements              Qui est arrivé, qui viendra et quand
  narthex agent <nom>               La fiche d'un coéquipier
  narthex entreprise [section] [page]  Vue d'ensemble, finances, ventes, marketing, juridique
  narthex depense                   La dépense IA, par coéquipier et par jour
  narthex tableaux                  Tous les tableaux produits par l'équipe
  narthex memoire                   Ce que l'équipe sait (faits datés, tirés des livrables)
  narthex oublier <id> --oui            Effacer un fait de la mémoire et du journal (définitif)
  narthex pourquoi "<question>"     Retrouver une décision et sa raison dans le journal
  narthex livrable <id|dernier>     Lire un livrable (--fichier x.md pour l'enregistrer)

${bold("Agir")} (seulement ce que la loi te réserve, ou pour arrêter quelque chose)
  narthex valider <id> [--forme SASU]   Dire que tu as fait une obligation
  narthex annuler <id>                  Annuler une action prévue
  narthex vente [montant] [--note "…"] Enregistrer une vente (la première ouvre l'étape « en activité »)
  narthex reessayer <id>                Relancer une obligation bloquée après plusieurs échecs
  narthex pause | reprendre             Mettre l'équipe en pause
  narthex recommencer [--oui]           Archiver l'entreprise et revoir le premier lancement

${bold("Réglages")}
  narthex config                    Voir la configuration
  narthex config cle                Enregistrer ta clé API Anthropic (ou ANTHROPIC_API_KEY)
  narthex config mode <auto|simulation|anthropic>
  narthex config modele <id>        Modèle Claude (défaut : claude-opus-5-5)
  narthex config delai <heures>     Délai pour annuler une action externe
  narthex config modele <rôle> <id> Modèle d'un agent (ex. : video claude-haiku-5-5)
  narthex config demander <sujet>   Réserver ou libérer un sujet (prix, publicite-payante, presse, contrat-client)
  narthex profil [--nom] [--prenom] [--ville]  Voir ou changer le profil
  narthex exporter                  Écrire l'entreprise dans un fichier JSON
  narthex config budget <dollars>   Dépense IA maximale par jour (défaut 3 $)
  narthex config budget-tache <dollars>  Dépense IA maximale par tâche (défaut 1,50 $)
  narthex avancer <heures>          Simulation : avancer l'horloge

${bold("Options")}  --dossier <chemin>  --json  --aide
Sans clé API, l'équipe prépare tout et attend ta clé : rien n'est inventé.`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dossier: { type: "string" },
    json: { type: "boolean" },
    aide: { type: "boolean", short: "h" },
    help: { type: "boolean" },
    nom: { type: "string" },
    idee: { type: "string" },
    prenom: { type: "string" },
    ville: { type: "string" },
    fichier: { type: "string" },
    "sans-lancer": { type: "boolean" },
    semaine: { type: "boolean" },
    agent: { type: "string" },
    forme: { type: "string" },
    nombre: { type: "string", short: "n" },
    oui: { type: "boolean" },
    note: { type: "string" },
  },
});

const dir = opts.dossier ?? dataDir();
const [command = "fil", ...args] = positionals;

async function main(): Promise<void> {
  if (opts.aide || opts.help || command === "aide" || command === "help") return print(HELP);
  switch (command) {
    case "init":
      return init();
    case "lancer":
    case "run":
      return lancer();
    case "config":
      return config();
    case "recommencer":
      return recommencer();
  }
  await withClient(async (client) => {
    const state = await client.call("state.get", {});
    if (!state) {
      print(`Pas encore d'entreprise ici. Commence par ${bold("narthex init")}.`);
      return;
    }
    const status = await client.call("engine.status", {});
    if (opts.json && ["fil", "equipe", "calendrier", "obligations"].includes(command)) return print(JSON.stringify(state, null, 2));
    switch (command) {
      case "fil":
        return print(render.fil(state, status, Number(opts.nombre ?? 15)));
      case "equipe":
      case "team":
        return print(render.equipe(state, status.now));
      case "calendrier":
      case "calendar": {
        const agent = opts.agent ? Object.values(state.agents).find((a) => a.name.toLowerCase() === opts.agent!.toLowerCase()) : undefined;
        if (opts.agent && !agent) throw new Error(`Personne ne s'appelle ${opts.agent} dans l'équipe.`);
        return print(render.calendrier(state, status.now, opts.semaine ? "semaine" : "jour", agent?.id));
      }
      case "obligations":
        return print(render.obligations(state));
      case "entreprise":
        return print(render.entreprise(state, status.now, args[0], args[1]));
      case "depense":
      case "dépense":
        return print(render.depense(state, await client.call("events.read", {})));
      case "tableaux":
        return print(render.tableaux(state));
      case "profil": {
        if (opts.nom || opts.prenom || opts.ville) {
          const next = await client.call("company.update", { ...(opts.nom ? { name: opts.nom } : {}), ...(opts.prenom ? { founderName: opts.prenom } : {}), ...(opts.ville ? { city: opts.ville } : {}) });
          return print(`Enregistré : ${next.company!.name}, ${next.company!.founder.name}${next.company!.city ? `, ${next.company!.city}` : ""}.`);
        }
        const c = state.company!;
        return print(`${bold(c.name)}\n${c.founder.name}${c.city ? ` · ${c.city}` : ""} · ${c.legalForm ?? "forme à choisir"}`);
      }
      case "exporter": {
        const events = await client.call("events.read", {});
        const file = opts.fichier ?? `${state.company!.name.replace(/[^\p{L}\p{N}-]+/gu, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
        writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), company: state.company, events }, null, 2));
        return print(`Exporté : ${file}`);
      }
      case "recrutements":
        return print(render.recrutementsView(state));
      case "agent": {
        const a = Object.values(state.agents).find((x) => x.name.toLowerCase() === (args[0] ?? "").toLowerCase());
        if (!a) throw new Error(`Personne ne s'appelle ${args[0] ?? "ainsi"} dans l'équipe.`);
        return print(render.agentView(state, a.id, status.now));
      }
      case "journal": {
        const events = await client.call("events.read", {});
        const n = Number(opts.nombre ?? 40);
        return print(opts.json ? JSON.stringify(events, null, 2) : render.journal(state, events, n));
      }
      case "memoire":
        return print(opts.json ? JSON.stringify(Object.values(state.facts), null, 2) : render.memoire(state, status.now));
      case "oublier": {
        const f = byPrefix(Object.values(state.facts), args[0], "donnée");
        if (!opts.oui) return print(`${bold("Oublier :")} ${clean(f.text)}\nC'est définitif : effacé de la mémoire et du journal. Confirme avec --oui.`);
        await client.call("fact.forget", { factId: f.id });
        return print(`${bold("Oublié.")} Effacé de la mémoire et du journal.`);
      }
      case "pourquoi": {
        const question = args.join(" ").trim();
        if (!question) throw new Error("Pose ta question : narthex pourquoi \"le dépôt-vente\"");
        return print(render.pourquoi(state, question));
      }
      case "livrable": {
        const all = Object.values(state.deliverables).sort((a, b) => b.createdAt - a.createdAt);
        const d = !args[0] || args[0] === "dernier" ? all[0] : all.find((x) => x.id.startsWith(args[0]!));
        if (!d) throw new Error("Livrable introuvable.");
        if (opts.fichier) {
          writeFileSync(opts.fichier, deliverableMarkdown(state, d));
          return print(`${bold("Enregistré.")} ${opts.fichier}`);
        }
        return print(opts.json ? JSON.stringify(d, null, 2) : render.livrable(state, d));
      }
      case "valider": {
        const o = byPrefix(Object.values(state.obligations), args[0], "obligation");
        const next = await client.call("obligation.fulfill", { obligationId: o.id, ...(opts.forme ? { legalForm: legalForm(opts.forme) } : {}) });
        print(`${bold("C'est noté.")} ${o.title}.`);
        return afterAction(next, status.passive);
      }
      case "vente": {
        const amountCents = args[0] ? fmt.parseDollars(args[0]) : undefined;
        if (amountCents !== undefined && !(amountCents >= 0)) throw new Error("Montant illisible : narthex vente 39,90");
        const next = await client.call("sale.record", { ...(amountCents !== undefined ? { amountCents } : {}), ...(opts.note ? { note: opts.note } : {}) });
        print(`${bold("Vente enregistrée.")}${amountCents !== undefined ? ` ${(amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}`);
        return afterAction(next, status.passive);
      }
      case "reessayer": {
        const o = byPrefix(Object.values(state.obligations), args[0], "obligation");
        const next = await client.call("obligation.retry", { obligationId: o.id });
        print(`${bold("C'est reparti.")} L'équipe reprend « ${clean(o.title)} ».`);
        return afterAction(next, status.passive);
      }
      case "annuler": {
        const t = byPrefix(Object.values(state.tasks), args[0], "tâche");
        await client.call("task.cancel", { taskId: t.id });
        return print(`Annulé : ${clean(t.title)}.`);
      }
      case "pause":
        await client.call("company.pause", {});
        return print("L'équipe est en pause. Les obligations restent suivies dans la liste. Reprends avec : narthex reprendre");
      case "reprendre":
        await client.call("company.resume", {});
        return print("L'équipe reprend.");
      case "avancer": {
        const hours = Number(args[0] ?? 24);
        if (!Number.isFinite(hours) || hours <= 0) throw new Error("Donne un nombre d'heures, par exemple : narthex avancer 24");
        const s = await client.call("clock.advance", { hours });
        return print(`Horloge avancée de ${hours} h.${s.passive ? " L'équipe travaillera au prochain « narthex lancer »." : ""}`);
      }
      case "statut":
      case "status":
        return print(JSON.stringify(status, null, 2));
      default:
        throw new Error(`Commande inconnue : ${command}. Voir narthex --aide`);
    }
  });
}

function afterAction(_state: CompanyState, passive: boolean): void {
  if (passive) print(dim("L'équipe s'en occupera au prochain « narthex lancer »."));
}

// ---------- Connecting ----------

/** Talks to a running `narthex lancer` when there is one, else opens the company read-and-record only. */
async function withClient(fn: (client: Client) => Promise<void>): Promise<void> {
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
    await fn(new InProcessClient(engine));
  } finally {
    await engine.close();
  }
}

// ---------- init ----------

async function init(): Promise<void> {
  await runSeuil({
    dir,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    given: { ...(opts.idee ? { idee: opts.idee } : {}), ...(opts.prenom ? { prenom: opts.prenom } : {}), ...(opts.nom ? { nom: opts.nom } : {}) },
  });
  if (opts["sans-lancer"] || (await isAlive(socketPath(dir)))) return print(`\n  Lance l'équipe quand tu veux : ${bold("narthex lancer")}`);
  print("");
  return lancer();
}

// ---------- recommencer ----------

async function recommencer(): Promise<void> {
  if (await isAlive(socketPath(dir))) throw new Error("L'équipe tourne (app ou « narthex lancer ») : ferme-la d'abord.");
  if (!opts.oui) {
    if (!process.stdin.isTTY) throw new Error("Ajoute --oui pour confirmer.");
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("L'entreprise actuelle sera archivée (rien n'est supprimé) et le premier lancement recommencera. On y va ? (o/n) ")).trim().toLowerCase();
    rl.close();
    if (!answer.startsWith("o")) return print("D'accord, rien n'a changé.");
  }
  const archived = archiveCompany(dir);
  print(archived ? `C'est fait. L'ancienne entreprise est rangée dans ${archived}.` : "Il n'y avait pas d'entreprise ici.");
  print(`Le premier lancement t'attend : ouvre l'app ou tape ${bold("narthex init")}.`);
}

// ---------- lancer ----------

async function lancer(): Promise<void> {
  if (await isAlive(socketPath(dir))) {
    print(`L'équipe travaille déjà dans un autre terminal ou dans l'app. Regarde le Fil : ${bold("narthex fil")}`);
    return;
  }
  const { engine } = openEngine({ dir });
  if (!engine.getState().company) {
    await engine.close();
    print(`Pas encore d'entreprise ici. Commence par ${bold("narthex init")}.`);
    return;
  }
  const server = await serve(engine, socketPath(dir));
  print(render.fil(engine.getState(), engine.status(), 8));
  if (engine.status().runtime === "anthropic") {
    print(dim(`Agents réels : Claude (${loadConfig(dir).model ?? DEFAULT_MODEL}) avec ta clé. Chaque tâche a un coût en dollars sur ton compte Anthropic ; la dépense IA s'affiche en haut du Fil.`));
  }
  if (engine.status().runtime === "claude-code") print(dim("Développement : les agents passent par ton Claude Code, sur ton abonnement claude.ai. Aucune clé API, aucune dépense en dollars."));
  print(rule());
  print(dim("En direct. Ctrl+C pour arrêter (l'équipe termine ce qu'elle a commencé)."));

  engine.subscribe((e) => {
    const s = engine.getState();
    if (e.type === "post.published") {
      const d = e.post.deliverableId ? s.deliverables[e.post.deliverableId] : undefined;
      print(render.postBlock(s, e.post.agentId, e.post.at, e.post.text, engine.now(), d));
    } else if (e.type === "task.started") {
      const t = s.tasks[e.taskId];
      if (t) print(dim(`  ${s.agents[t.agentId]?.name} commence : ${clean(t.title)}`));
    }
  });
  engine.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      engine.abortAll();
      process.exit(130);
    }
    stopping = true;
    print(dim("\nJ'attends que l'équipe finisse ce qu'elle a commencé… (Ctrl+C encore pour couper net)"));
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
  const [key, value] = args;
  const next: Config = { ...current };
  switch (key) {
    case undefined: {
      const shown = { ...current, ...(current.anthropicApiKey ? { anthropicApiKey: `${current.anthropicApiKey.slice(0, 10)}…` } : {}) };
      print(`${bold("Dossier")} ${dir}\n${bold("Mode")} ${chooseRuntime(current)}\n${JSON.stringify(shown, null, 2)}`);
      return;
    }
    case "cle": {
      const k = value ?? (await readSecret("Clé API Anthropic (sk-ant-…) › "));
      if (!k.startsWith("sk-ant-")) throw new Error("Ça ne ressemble pas à une clé Anthropic (sk-ant-…).");
      next.anthropicApiKey = k;
      break;
    }
    case "mode":
      if (value === "auto") delete next.runtime;
      else if (value === "simulation" || value === "anthropic") next.runtime = value;
      else throw new Error("Mode : auto, simulation ou anthropic.");
      break;
    case "modele": {
      if (!value) throw new Error("Donne un identifiant de modèle, par exemple claude-opus-5-5.");
      const perRole = args[2];
      if (perRole) {
        if (!ROLES.some((r) => r.id === value)) throw new Error(`Rôle inconnu : ${value}. Choix : ${ROLES.map((r) => r.id).join(", ")}.`);
        next.models = { ...next.models, [value]: perRole };
        break;
      }
      next.model = value;
      break;
    }
    case "demander": {
      const topic = ALWAYS_ASK.find((t) => t.tag === value);
      if (!topic) throw new Error(`Sujet inconnu. Choix : ${ALWAYS_ASK.map((t) => t.tag).join(", ")}.`);
      let now: string[] = [];
      await withClient(async (client) => {
        const state = await client.call("state.get", {});
        const current = state?.settings.alwaysAsk ?? [];
        now = current.includes(topic.tag) ? current.filter((t) => t !== topic.tag) : [...current, topic.tag];
        await client.call("settings.update", { patch: { alwaysAsk: now } });
      });
      return print(`${topic.label} : ${now.includes(topic.tag) ? "l'équipe te demandera avant" : "l'équipe décide seule"}.`);
    }
    case "vitesse":
      next.simulationSpeed = Number(value);
      break;
    case "budget":
    case "budget-tache": {
      const credits = fmt.parseDollars(value ?? "");
      if (!Number.isFinite(credits)) throw new Error("Donne un montant en dollars, par exemple 3 ou 1,50.");
      const patch = key === "budget" ? { dailyBudgetCredits: credits } : { taskBudgetCredits: credits };
      await withClient(async (client) => {
        await client.call("settings.update", { patch });
      });
      return print(`${key === "budget" ? "Dépense IA maximale par jour" : "Dépense IA maximale par tâche"} : ${fmt.dollars(credits)}.`);
    }
    case "delai": {
      const hours = Number(value);
      if (!Number.isFinite(hours) || hours < 0) throw new Error("Donne un nombre d'heures.");
      await withClient(async (client) => {
        await client.call("settings.update", { patch: { cancelWindowHours: hours } });
      });
      return print(`Délai d'annulation : ${hours} h.`);
    }
    default:
      throw new Error(`Réglage inconnu : ${key}`);
  }
  saveConfig(dir, next);
  print("Enregistré. Il s'applique au prochain « narthex lancer ».");
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
  if (!prefix) throw new Error(`Donne l'identifiant de la ${what} (affiché dans le Fil).`);
  const found = items.filter((i) => i.id === prefix || i.id.startsWith(prefix));
  if (found.length === 0) throw new Error(`Aucune ${what} ne correspond à « ${prefix} ».`);
  if (found.length > 1) throw new Error(`Plusieurs ${what}s correspondent à « ${prefix} » : donne plus de caractères.`);
  return found[0]!;
}

function legalForm(v: string): LegalForm {
  const forms: LegalForm[] = ["SASU", "SAS", "EURL", "SARL", "EI", "micro"];
  const f = forms.find((x) => x.toLowerCase() === v.toLowerCase());
  if (!f) throw new Error(`Forme inconnue : ${v}. Choix : ${forms.join(", ")}.`);
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
  process.stderr.write(`${red("Erreur")} ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

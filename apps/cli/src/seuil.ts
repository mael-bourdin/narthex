import { createInterface } from "node:readline/promises";
import { onboardingTeam, ROLE_PROMISE, SEUIL, type FirstLook } from "@narthex/core";
import {
  AnthropicRuntime,
  loadConfig,
  needsKey,
  openEngine,
  saveKey,
  SocketClient,
  socketPath,
  verifyAnthropicKey,
  InProcessClient,
  type Client,
  type Host,
} from "@narthex/engine";
import { bold, clean, colours, dim, streamWords, violet } from "./style.ts";

export interface SeuilOptions {
  dir: string;
  interactive: boolean;
  given: { idee?: string; prenom?: string; nom?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, colours ? ms : 0));
const print = (text = "") => process.stdout.write(`${text}\n`);

/** `narthex init`: the first launch, in a terminal. Same words as the app, same steps. */
export async function runSeuil(options: SeuilOptions): Promise<void> {
  const socket = await SocketClient.connect(socketPath(options.dir));
  const engine: Host | undefined = socket ? undefined : openEngine({ dir: options.dir, passive: true }).engine;
  const client: Client = socket ?? new InProcessClient(engine!);
  // Readline is created after the key step: while it listens, it would echo the key in clear.
  const io: { rl: ReturnType<typeof createInterface> | null } = { rl: null };
  const reader = () => (io.rl ??= options.interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null);
  const say = (text: string) => (options.interactive ? streamWords(text) : Promise.resolve(print(`  ${clean(text)}`)));

  const ask = async (given: string | undefined, flag: string): Promise<string> => {
    if (given?.trim()) return given.trim();
    const r = reader();
    if (!r) throw new Error(`Il manque --${flag} (pas de terminal interactif).`);
    for (;;) {
      const answer = (await r.question(`  ${violet("›")} `)).trim();
      if (answer) return answer;
    }
  };

  try {
    // Several companies can live side by side: « init » founds one more, the others keep running.
    const others = await client.call("companies.list", {});
    if (others.length) print(dim(`  Une entreprise de plus, à côté de : ${others.map((c) => c.name).join(", ")}.`));
    print();
    print(violet("     ╭──╮"));
    print(violet("     │░░│"));
    print(violet("    ─┴──┴─"));
    print();
    await sleep(600);

    await say(SEUIL.hello);
    if (options.interactive && needsKey(loadConfig(options.dir))) {
      await say(SEUIL.askKey);
      print(dim(`  ${SEUIL.keyAside}`));
      print(dim("  Entrée sans rien : plus tard (l'équipe attendra ta clé)."));
      for (;;) {
        const raw = await readMasked(`  ${violet("›")} `);
        if (!raw.trim()) {
          await say(SEUIL.noKeyYet);
          await say(SEUIL.askNameNoKey);
          break;
        }
        print(dim(`  ${SEUIL.checking}`));
        const check = await verifyAnthropicKey(raw);
        if (check.ok) {
          const config = saveKey(options.dir, check.key);
          engine?.useRuntime(new AnthropicRuntime({ apiKey: check.key, ...(config.model ? { model: config.model } : {}) }));
          print(violet("  ✦"));
          await say(SEUIL.askName);
          break;
        }
        await say(check.message);
      }
    } else {
      await say(SEUIL.askNameNoKey);
    }
    const name = await ask(options.given.prenom, "prenom");
    await say(SEUIL.askIdea(name));
    const idea = await ask(options.given.idee, "idee");

    await say(SEUIL.searching);
    const look: FirstLook = await client.call("onboarding.firstLook", { idea, founderName: name });
    print();
    await say(look.reaction);
    for (const f of look.findings) {
      await sleep(300);
      print(`    ${violet("·")} ${clean(f.text)}  ${dim(clean(f.source))}`);
    }

    print();
    await say(SEUIL.team);
    const team = onboardingTeam(look);
    for (const r of team.now) {
      await sleep(400);
      print(`    ${violet("●")} ${bold(r.defaultName)} ${dim(`· ${r.title}`)}  ${ROLE_PROMISE[r.id]}`);
    }
    for (const r of team.later) {
      await sleep(300);
      print(dim(`    ○ ${r.defaultName} · ${r.title}  ${SEUIL.later}`));
    }

    print();
    await say(SEUIL.askCompany);
    for (let given = options.given.nom; ; given = undefined) {
      const company = await ask(given, "nom");
      try {
        await client.call("company.found", { name: company, idea, founderName: name, firstLook: look });
        print();
        await say(SEUIL.welcome(company));
        break;
      } catch (e) {
        if (!options.interactive) throw e;
        await say(e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    io.rl?.close();
    if (socket) await socket.close();
    if (engine) await engine.close();
  }
}

/** Reads a secret, showing its first 11 characters (« sk-ant-api0 ») then dots. Paste works. */
export async function readMasked(
  prompt: string,
  input: NodeJS.ReadStream = process.stdin,
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
): Promise<string> {
  if (!input.isTTY) {
    let data = "";
    for await (const chunk of input) data += chunk;
    return data.trim();
  }
  output.write(prompt);
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve) => {
    let secret = "";
    let shown = 0;
    const render = () => {
      const view = secret.length > 11 ? secret.slice(0, 11) + "•".repeat(Math.min(secret.length - 11, 26)) : secret;
      output.write(`${shown ? `\u001b[${shown}D\u001b[K` : ""}${view}`);
      shown = view.length;
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          render();
          input.setRawMode(wasRaw);
          input.pause();
          input.off("data", onData);
          output.write("\n");
          resolve(secret.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") secret = secret.slice(0, -1);
        else if (ch >= " ") secret += ch;
      }
      render();
    };
    input.on("data", onData);
  });
}

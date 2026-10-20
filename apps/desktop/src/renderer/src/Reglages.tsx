import { useEffect, useState } from "react";
import { ALWAYS_ASK, fmt, role, ROLES, spendBreakdown, type CompanyState, type EngineStatus, type Mission, type StoredEvent } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";

export type ReglagesView = "Profil" | "Budget" | "Notifications" | "Autonomie" | "Intégrations" | "API et modèles" | "Membres" | "Sécurité";
const VIEWS: ReglagesView[] = ["Profil", "Budget", "Notifications", "Autonomie", "Intégrations", "API et modèles", "Membres", "Sécurité"];

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Le plus solide" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Deux fois moins cher" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Le plus léger" },
];

type Config = Awaited<ReturnType<typeof window.narthex.config.get>>;

const cleanError = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** Réglages (Figma section 6): the rules the team follows, the key, the models, the data. */
export function Reglages({ state, status, view, onView, onChange }: { state: CompanyState; status: EngineStatus; view: ReglagesView; onView(v: ReglagesView): void; onChange(): void }) {
  const [config, setConfig] = useState<Config>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const reload = () => void window.narthex.config.get().then(setConfig);
  useEffect(reload, [state.lastSeq]);
  useEffect(() => {
    void window.narthex.call("events.read", {}).then(setEvents);
  }, [state.lastSeq]);

  return (
    <div className="columns">
      <div className="main">
        <SectionTabs items={VIEWS} active={view} onSelect={onView} />
        <h1>Réglages</h1>
        {view === "Profil" && <Profil state={state} onChange={onChange} />}
        {view === "Budget" && <Budget state={state} status={status} onChange={onChange} />}
        {view === "Notifications" && config && <Notifications config={config} onSaved={reload} />}
        {view === "Autonomie" && <Autonomie state={state} onChange={onChange} />}
        {view === "Intégrations" && (
          <>
            <DiscordCard />
            <Integrations />
          </>
        )}
        {view === "API et modèles" && config && <ApiModels state={state} status={status} config={config} events={events} onChange={() => (reload(), onChange())} />}
        {view === "Membres" && <Membres state={state} />}
        {view === "Sécurité" && config && <Securite config={config} />}
      </div>
      <aside className="side">
        <section className="card">
          <header className="card-head">
            <span>Cette semaine</span>
          </header>
          <WeekStats state={state} now={status.now} events={events} />
        </section>
      </aside>
    </div>
  );
}

function MargauxSays({ children, text }: { children?: React.ReactNode; text: string }) {
  return (
    <section className="fil-list">
      <article className="publication">
        <header className="post-head">
          <PixelAvatar role="cofondateur" size={36} />
          <span className="name">Margaux</span>
          <span className="muted">· Co-fondatrice</span>
        </header>
        <p className="text">{text}</p>
        {children}
      </article>
    </section>
  );
}

function Saved({ message }: { message?: string }) {
  return message ? <p className={message.startsWith("!") ? "error small" : "muted small"}>{message.replace(/^!/, "")}</p> : null;
}

// ---------- Profil ----------

function Profil({ state, onChange }: { state: CompanyState; onChange(): void }) {
  const c = state.company!;
  const [founderName, setFounderName] = useState(c.founder.name);
  const [name, setName] = useState(c.name);
  const [city, setCity] = useState(c.city ?? "");
  const [message, setMessage] = useState<string>();
  const save = async () => {
    try {
      await window.narthex.call("company.update", { founderName, name, city });
      setMessage("Enregistré.");
      onChange();
    } catch (e) {
      setMessage(`!${cleanError(e)}`);
    }
  };
  return (
    <MargauxSays text="C'est ainsi que l'équipe te nomme, toi et ton entreprise, dans ses messages et ses documents.">
      <div className="form-box">
        <label className="form-row">
          <span>Ton prénom</span>
          <input value={founderName} onChange={(e) => setFounderName(e.target.value)} />
        </label>
        <label className="form-row">
          <span>Nom de l'entreprise</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="form-row">
          <span>Ville</span>
          <input value={city} placeholder="Lille" onChange={(e) => setCity(e.target.value)} />
        </label>
        <div className="form-row static">
          <span>Forme juridique</span>
          <span className="muted">{c.legalForm ?? "Pas encore choisie : Hugo te la demandera"}</span>
        </div>
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={save}>
          Enregistrer
        </button>
      </div>
      <Saved {...(message ? { message } : {})} />
    </MargauxSays>
  );
}

// ---------- Dépense IA et budget ----------

function Budget({ state, status, onChange }: { state: CompanyState; status: EngineStatus; onChange(): void }) {
  const [acting, setActing] = useState<Mission>();
  const today = state.usage.byDay?.[new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(status.now)] ?? 0;
  return (
    <>
      <section className="pilot">
        <span className="pilot-dot on" />
        <div>
          <div>Version open source</div>
          <div className="muted small">Tu paies directement Anthropic avec ta clé. Narthex ne prend rien au passage.</div>
        </div>
      </section>
      <MargauxSays text="Je surveille la dépense pour toi : chaque tâche a un plafond, et l'équipe s'arrête pour la journée quand le budget du jour est atteint.">
        <div className="form-box">
          <div className="form-row static">
            <span>Aujourd'hui</span>
            <span>
              {fmt.dollars(today)} <span className="muted">sur {fmt.dollars(state.settings.dailyBudgetCredits)}</span>
            </span>
          </div>
          <div className="form-row static">
            <span>Par tâche, au plus</span>
            <span>{fmt.dollars(state.settings.taskBudgetCredits)}</span>
          </div>
          <div className="form-row static">
            <span>Depuis le début</span>
            <span>{fmt.dollars(state.usage.credits)}</span>
          </div>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              setActing({ id: "budget", kind: "budget", eyebrow: "Dépense IA", title: "Ajuster le budget", why: "La dépense IA est facturée par Anthropic sur ton compte.", action: "budget", label: "" })
            }
          >
            Ajuster le budget
          </button>
        </div>
      </MargauxSays>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </>
  );
}

// ---------- Notifications ----------

function Notifications({ config, onSaved }: { config: Config; onSaved(): void }) {
  const [n, setN] = useState(config.notifications);
  const rows: [keyof Config["notifications"], string, string][] = [
    ["legal", "Ce que la loi te réserve", "Une signature, une vérification d'identité, un choix à faire."],
    ["leaving", "Une action va partir", "Un envoi, une publication, un dépôt : tu peux encore l'annuler."],
    ["budget", "Budget du jour atteint", "L'équipe s'arrête jusqu'au lendemain."],
    ["deliverables", "Chaque nouveau livrable", "Une étude, un document, une liste terminée."],
  ];
  const toggle = async (k: keyof Config["notifications"]) => {
    const next = { ...n, [k]: !n[k] };
    setN(next);
    await window.narthex.config.setNotifications(next);
    onSaved();
  };
  return (
    <MargauxSays text="Je ne te dérange que pour ce qui compte. Les notifications s'affichent quand l'app n'est pas au premier plan.">
      <div className="form-box">
        {rows.map(([k, title, why]) => (
          <label key={k} className="form-row toggle">
            <span>
              {title}
              <span className="muted small block">{why}</span>
            </span>
            <input type="checkbox" checked={n[k]} onChange={() => void toggle(k)} />
          </label>
        ))}
      </div>
    </MargauxSays>
  );
}

// ---------- Autonomie ----------

function Autonomie({ state, onChange }: { state: CompanyState; onChange(): void }) {
  const [hours, setHours] = useState(String(state.settings.cancelWindowHours));
  const [topics, setTopics] = useState(state.settings.alwaysAsk);
  const [message, setMessage] = useState<string>();
  const paused = state.company?.paused;
  const save = async () => {
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0) return setMessage("!Donne un nombre d'heures.");
    await window.narthex.call("settings.update", { patch: { cancelWindowHours: h, alwaysAsk: topics } });
    setMessage("Enregistré. L'équipe suit ces règles dès maintenant.");
    onChange();
  };
  return (
    <>
      <section className="pilot">
        <span className={`pilot-dot ${paused ? "waiting" : "on"}`} />
        <div>
          <div>{paused ? "L'équipe est en pause" : "L'équipe agit seule dans ces limites"}</div>
          <div className="muted small">Tu les fixes une fois, on s'y tient.</div>
        </div>
      </section>
      <MargauxSays text="Voici les règles qu'on suit. Je te conseille de les garder au début, puis de les desserrer quand tu nous fais confiance.">
        <div className="form-box">
          <label className="form-row">
            <span>
              Délai pour annuler
              <span className="muted small block">Entre l'annonce d'une action externe et son départ</span>
            </span>
            <select value={hours} onChange={(e) => setHours(e.target.value)}>
              {["0", "2", "6", "12", "24", "48", "72"].map((h) => (
                <option key={h} value={h}>
                  {h === "0" ? "Aucun" : `${h} heures`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-box">
          <div className="form-title">Toujours me demander avant</div>
          <p className="muted small">L'action attend alors le délai d'annulation, même si l'agent a gagné en autonomie.</p>
          <div className="chips">
            {ALWAYS_ASK.map((t) => {
              const on = topics.includes(t.tag);
              return (
                <button key={t.tag} className={on ? "chip on" : "chip"} onClick={() => setTopics(on ? topics.filter((x) => x !== t.tag) : [...topics, t.tag])}>
                  {on ? "✓ " : "+ "}
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => {
              setHours("24");
              setTopics(["prix", "publicite-payante"]);
            }}
          >
            Rétablir mes conseils
          </button>
        </div>
        <Saved {...(message ? { message } : {})} />
      </MargauxSays>
      <MargauxSays text={paused ? "L'équipe est en pause. Les obligations légales restent suivies." : "Si tu dois t'absenter ou si quelque chose ne va pas, tu peux mettre toute l'équipe en pause. Les obligations légales restent suivies."}>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => void window.narthex.call(paused ? "company.resume" : "company.pause", {}).then(onChange)}>
            {paused ? "Reprendre" : "Mettre l'équipe en pause"}
          </button>
        </div>
      </MargauxSays>
    </>
  );
}

// ---------- Intégrations ----------

function DiscordCard() {
  type Status = Awaited<ReturnType<typeof window.narthex.discord.get>>;
  const [status, setStatus] = useState<Status>();
  const [token, setToken] = useState("");
  const [guilds, setGuilds] = useState<{ id: string; name: string }[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const reload = () => void window.narthex.discord.get().then(setStatus);
  useEffect(reload, []);

  const check = async () => {
    setBusy(true);
    setMessage(undefined);
    const r = await window.narthex.discord.check(token);
    setBusy(false);
    if (!r.ok) return setMessage(r.message);
    if (r.guilds.length === 0) return setMessage(`Bot ${r.bot} reconnu, mais il n'est sur aucun serveur : invite-le d'abord (étape 2).`);
    if (r.guilds.length === 1) return choose(r.guilds[0]!);
    setGuilds(r.guilds);
  };
  const choose = async (g: { id: string; name: string }) => {
    await window.narthex.discord.save({ token, guildId: g.id, guildName: g.name });
    setToken("");
    setGuilds(undefined);
    reload();
  };

  return (
    <MargauxSays text="Branche ton Discord et l'équipe y parle aussi : un salon par équipe, chacun sous son nom, des réponses et des réactions. Tu suis la société sans ouvrir l'app. Les réponses entre collègues comptent dans la dépense IA (quelques centimes par jour).">
      <div className="form-box discord">
        {status?.connected ? (
          <>
            <div className="form-row static">
              <span>
                Discord · {status.guildName}
                <span className="muted small block">Une catégorie par entreprise : #général, #décisions, #recherche, #juridique-et-compta, #ventes-et-com.</span>
              </span>
              <button className="btn btn-quiet" onClick={() => void window.narthex.discord.off().then(reload)}>
                Débrancher
              </button>
            </div>
            {!status.ownsEngine && <p className="muted small">L'équipe tourne dans un terminal : relance « narthex lancer » pour qu'elle écrive sur Discord.</p>}
          </>
        ) : (
          <>
            <div className="form-title">Discord</div>
            <ol className="steps small">
              <li>
                Sur <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">discord.com/developers</a> : New Application, puis Bot, puis Reset Token. Copie le jeton.
              </li>
              <li>OAuth2 · URL Generator : coche « bot », puis Gérer les salons, Gérer les webhooks, Envoyer des messages, Ajouter des réactions, Créer des fils publics. Ouvre l'URL et invite le bot sur ton serveur.</li>
              <li>Colle le jeton ici. Il reste sur ton ordinateur.</li>
            </ol>
            {guilds ? (
              <div className="chips">
                {guilds.map((g) => (
                  <button key={g.id} className="chip" onClick={() => void choose(g)}>
                    {g.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="key-row">
                <input type="password" value={token} placeholder="Jeton du bot" aria-label="Jeton du bot Discord" onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && token.trim() && void check()} />
                <button className="btn btn-primary" disabled={!token.trim() || busy} onClick={() => void check()}>
                  {busy ? "Vérification…" : "Brancher"}
                </button>
              </div>
            )}
            {message && <p className="error small">{message}</p>}
          </>
        )}
      </div>
    </MargauxSays>
  );
}

function Integrations() {
  const items = [
    ["Guichet unique de l'INPI", "Préparer et suivre l'immatriculation", "Hugo"],
    ["Boîte e-mail", "Envoyer les messages de prospection, avec délai d'annulation", "Samir"],
    ["Plateforme de facturation électronique", "Émettre et recevoir des factures conformes", "Paul"],
    ["Banque (lecture seule)", "Suivre la trésorerie sans pouvoir payer", "Margaux"],
    ["Réseaux sociaux", "Programmer les publications validées", "Jeanne"],
  ];
  return (
    <MargauxSays text="L'équipe cherche sur le web, interroge le registre officiel des entreprises, et peut écrire sur ton Discord. Les services qui agissent pour toi arrivent ensuite, dans l'ordre où ils serviront.">
      <div className="form-box">
        {items.map(([name, what, who]) => (
          <div key={name} className="form-row static">
            <span>
              {name}
              <span className="muted small block">
                {what} · {who}
              </span>
            </span>
            <span className="muted small">Pas encore disponible</span>
          </div>
        ))}
      </div>
    </MargauxSays>
  );
}

// ---------- API et modèles ----------

function ApiModels({ state, status, config, events, onChange }: { state: CompanyState; status: EngineStatus; config: Config; events: StoredEvent[]; onChange(): void }) {
  const [acting, setActing] = useState<Mission>();
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(config.models).filter(([, v]) => v)) as Record<string, string>);
  const [message, setMessage] = useState<string>();
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const roles = [...new Set([...agents.map((a) => a.role), ...ROLES.map((r) => r.id)])];
  const week = spendBreakdown(
    state,
    events.filter((e) => e.ts > status.now - 7 * 86_400_000),
  );
  const perMonth = (r: string) => {
    const credits = week.byAgent.filter((a) => a.role === r).reduce((s, a) => s + a.credits, 0);
    return credits ? `≈ ${fmt.dollars(Math.round((credits * 30) / 7))}` : "—";
  };
  const save = async () => {
    await window.narthex.config.setModels(models);
    setMessage(config.ownsEngine ? "Enregistré. Chaque agent utilise son modèle dès sa prochaine étape." : "Enregistré. Il s'appliquera au prochain lancement de l'équipe.");
    onChange();
  };
  return (
    <>
      <section className="pilot">
        <span className={`pilot-dot ${config.hasKey ? "on" : "waiting"}`} />
        <div>
          <div>Version open source</div>
          <div className="muted small">Tu fournis ta clé et tu choisis le modèle de chaque agent.</div>
        </div>
      </section>
      <MargauxSays text="Ta clé reste sur ta machine, Narthex ne l'envoie qu'à Anthropic. Pour chaque rôle, tu peux choisir un modèle : le plus solide pour le juridique et moi, plus léger pour ce qui est simple.">
        <div className="form-box">
          <div className="form-title">Clé Anthropic</div>
          <div className="form-row static">
            <span>{config.hasKey ? config.keyHint : "Pas de clé"}</span>
            <span className="row-actions">
              <span className={config.hasKey ? "small status-ok" : "muted small"}>{config.hasKey ? "Valide" : "L'équipe attend"}</span>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  setActing({ id: "key", kind: "key", eyebrow: "API et modèles", title: config.hasKey ? "Remplacer ta clé API" : "Ajoute ta clé API", why: "Elle reste sur ton ordinateur.", action: "key", label: "" })
                }
              >
                {config.hasKey ? "Remplacer" : "Ajouter"}
              </button>
            </span>
          </div>
        </div>
        <div className="form-box">
          <div className="form-title">Modèle par agent</div>
          {roles.map((r) => {
            const agent = agents.find((a) => a.role === r);
            return (
              <label key={r} className="form-row">
                <span className="with-avatar">
                  <PixelAvatar role={r} size={22} dim={!agent} />
                  {agent?.name ?? role(r).defaultName}
                  <span className="muted small">· {role(r).title}</span>
                </span>
                <span className="row-actions">
                  <span className="muted small">{perMonth(r)} / mois</span>
                  <select value={models[r] ?? role(r).model} onChange={(e) => setModels({ ...models, [r]: e.target.value })}>
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            );
          })}
          <p className="muted small">Estimation au rythme des 7 derniers jours. Opus 5.5 : le plus solide ; Sonnet 5.5 : deux fois moins cher ; Haiku 5.5 : le plus léger.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
        </div>
        <Saved {...(message ? { message } : {})} />
      </MargauxSays>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </>
  );
}

// ---------- Membres ----------

function Membres({ state }: { state: CompanyState }) {
  return (
    <MargauxSays text="Pour l'instant, Narthex se joue seul : une entreprise, une fondatrice ou un fondateur, et l'équipe d'agents. Inviter un associé viendra avec la version hébergée.">
      <div className="form-box">
        <div className="form-row static">
          <span className="with-avatar">
            <PixelAvatar founder size={24} /> {state.company?.founder.name}
          </span>
          <span className="muted small">Fondatrice ou fondateur · tous les droits</span>
        </div>
      </div>
    </MargauxSays>
  );
}

// ---------- Sécurité et données ----------

function Securite({ config }: { config: Config }) {
  const [message, setMessage] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <MargauxSays text="Tout reste sur ton ordinateur : le journal de l'entreprise, les livrables et ta clé. Rien ne passe par un serveur de Narthex.">
        <div className="form-box">
          <div className="form-row static">
            <span>
              Dossier des données
              <span className="muted small block">{config.dir}</span>
            </span>
          </div>
          <div className="form-row static">
            <span>
              Clé API
              <span className="muted small block">Dans le fichier de configuration, lisible par ton seul compte</span>
            </span>
          </div>
          <div className="form-row static">
            <span>
              Connexion entre l'app et le terminal
              <span className="muted small block">Locale uniquement, réservée à ton compte ; rien n'écoute sur le réseau</span>
            </span>
          </div>
        </div>
        <div className="actions">
          <button
            className="btn btn-secondary"
            onClick={() =>
              void window.narthex.data
                .export()
                .then((f) => setMessage(`Exporté : ${f}`))
                .catch((e: unknown) => setMessage(`!${cleanError(e)}`))
            }
          >
            Exporter l'entreprise
          </button>
        </div>
        <Saved {...(message ? { message } : {})} />
      </MargauxSays>
      <MargauxSays text="Tu veux repartir de zéro ? Toutes tes entreprises sont rangées dans les archives (rien n'est supprimé) et le premier lancement recommence. Pour en créer juste une autre, passe par le menu en haut à gauche.">
        <div className="actions">
          {confirm ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() => void window.narthex.data.restart().catch((e: unknown) => setMessage(`!${cleanError(e)}`))}
              >
                Archiver et recommencer
              </button>
              <button className="btn btn-quiet" onClick={() => setConfirm(false)}>
                Annuler
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={() => setConfirm(true)}>
              Recommencer
            </button>
          )}
        </div>
      </MargauxSays>
    </>
  );
}

// ---------- Right column ----------

function WeekStats({ state, now, events }: { state: CompanyState; now: number; events: StoredEvent[] }) {
  const week = events.filter((e) => e.ts > now - 7 * 86_400_000);
  const done = week.filter((e) => e.type === "task.completed").length;
  const cancelled = week.filter((e) => e.type === "task.cancelled" && e.by === "founder").length;
  const spent = week.filter((e) => e.type === "usage.recorded").reduce((s, e) => s + (e as { credits: number }).credits, 0);
  return (
    <>
      <div className="kpi">
        <div>
          <div>{done} missions faites seules</div>
          <div className="muted small">Dans les limites fixées</div>
        </div>
      </div>
      <div className="kpi">
        <div>
          <div>{cancelled} annulée{cancelled > 1 ? "s" : ""} par toi</div>
          <div className="muted small">Tu peux toujours le faire</div>
        </div>
      </div>
      <div className="kpi">
        <div>
          <div>{fmt.dollars(spent)} de dépense IA</div>
          <div className="muted small">Plafond : {fmt.dollars(state.settings.dailyBudgetCredits)} par jour</div>
        </div>
      </div>
    </>
  );
}

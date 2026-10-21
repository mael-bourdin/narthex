import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ALWAYS_ASK,
  fmt,
  founderRoles,
  LEVEL_LABEL,
  role,
  roleLevel,
  ROLES,
  spendBreakdown,
  spendByAgent,
  toolUsers,
  type CompanyState,
  type EngineStatus,
  type Mission,
  type RoleId,
  type StoredEvent,
} from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";
import "./reglages.css";

export type ReglagesView = "Profil" | "Budget" | "Notifications" | "Autonomie" | "Intégrations" | "API et modèles" | "Membres" | "Sécurité";
const VIEWS: ReglagesView[] = ["Profil", "Budget", "Notifications", "Autonomie", "Intégrations", "API et modèles", "Membres", "Sécurité"];


const DAY = 86_400_000;

type Config = Awaited<ReturnType<typeof window.narthex.config.get>>;

const cleanError = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** Réglages (Figma « Narthex — App », section Réglages): the rules the team follows, the key, the models, the data. */
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
      <div className="main reglages">
        <SectionTabs items={VIEWS} active={view} onSelect={onView} />
        <h1>Réglages</h1>
        {view === "Profil" && <Profil state={state} onChange={onChange} />}
        {view === "Budget" && <Budget state={state} status={status} events={events} onChange={onChange} />}
        {view === "Notifications" && config && <Notifications state={state} config={config} onSaved={reload} />}
        {view === "Autonomie" && <Autonomie state={state} onChange={onChange} />}
        {view === "Intégrations" && <Integrations state={state} />}
        {view === "API et modèles" && config && <ApiModels state={state} status={status} config={config} events={events} onChange={() => (reload(), onChange())} />}
        {view === "Membres" && <Membres state={state} />}
        {view === "Sécurité" && config && <Securite state={state} config={config} />}
      </div>
      <aside className="side reglages-side">
        {view === "Profil" && <SideList title="Ton rôle" items={founderRoles(state.company?.legalForm)} />}
        {view === "Budget" && <BudgetSide state={state} status={status} events={events} />}
        {view === "Notifications" && config && <NotificationsSide config={config} />}
        {view === "Autonomie" && <WeekStats state={state} now={status.now} events={events} />}
        {view === "Intégrations" && <IntegrationsSide />}
        {view === "API et modèles" && config && <ApiSide status={status} config={config} events={events} />}
        {view === "Membres" && (
          <SideList
            title="Rôles prévus"
            aside="pas encore"
            items={[
              { title: "Associé", detail: "Tout voir, signer s'il est mandataire" },
              { title: "Expert-comptable", detail: "Finances et compta, en lecture" },
              { title: "Lecture seule", detail: "Le Fil et l'entreprise" },
            ]}
          />
        )}
        {view === "Sécurité" && config && (
          <SideList
            title="État"
            items={[
              { title: "Tout en local", detail: "Aucun serveur Narthex entre toi et ton fournisseur d'IA" },
              { title: config.hasKey ? "Clé API enregistrée" : "Pas encore de clé API", detail: config.hasKey ? `${config.keyHint ?? ""} · sur cet ordinateur` : "L'équipe attend ta clé pour travailler" },
            ]}
          />
        )}
      </aside>
    </div>
  );
}

// ---------- Figma components: Publications, Tableau, Interrupteur, Choix, cartes de colonne ----------

/** Who speaks on a page: the agent of that role when hired, else Margaux. */
function speaker(state: CompanyState, r: RoleId): RoleId {
  return Object.values(state.agents).some((a) => a.role === r) ? r : "cofondateur";
}

/** « Publications »: one card, posts separated by a line, like the Fil. */
function Posts({ children }: { children: ReactNode }) {
  return <section className="fil-list">{children}</section>;
}

function Post({ state, by = "cofondateur", text, children }: { state: CompanyState; by?: RoleId; text: string; children?: ReactNode }) {
  const agent = Object.values(state.agents).find((a) => a.role === by);
  return (
    <article className="publication rg-post">
      <header className="post-head">
        <PixelAvatar role={by} size={36} />
        <span className="name">{agent?.name ?? role(by).defaultName}</span>
        <span className="muted">· {role(by).title}</span>
      </header>
      <p className="text">{text}</p>
      {children}
    </article>
  );
}

/** « Tableau »: a dark box with an optional title, optional column heads, and rows. */
function Table({ title, cols, grid, note, children }: { title?: string; cols?: string[]; grid?: string; note?: string; children: ReactNode }) {
  return (
    <div className="rg-table" style={grid ? ({ "--grid": grid } as React.CSSProperties) : undefined}>
      {title && <div className="rg-table-title">{title}</div>}
      {cols && (
        <div className="rg-cells rg-head">
          {cols.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}
      {children}
      {note && <p className="rg-note">{note}</p>}
    </div>
  );
}

/** A row of a Tableau: a label (with an optional line under it) and its control. */
function Row({ label, sub, children, as: As = "div" }: { label: ReactNode; sub?: ReactNode; children?: ReactNode; as?: "div" | "label" }) {
  return (
    <As className="rg-row">
      <span className="rg-text">
        <span>{label}</span>
        {sub && <span className="rg-sub">{sub}</span>}
      </span>
      {children}
    </As>
  );
}

/** A row of a Tableau with columns (template from the Tableau's `grid`). */
function Cells({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <div className={dim ? "rg-cells rg-line dim" : "rg-cells rg-line"}>{children}</div>;
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle(): void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? "rg-switch on" : "rg-switch"} onClick={onToggle} />;
}

function Choice({ value, onChange, options, label, wide }: { value: string; onChange(v: string): void; options: { value: string; label: string }[]; label: string; wide?: boolean }) {
  return (
    <select className={wide ? "rg-select wide" : "rg-select"} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function State({ tone, children }: { tone: "ok" | "off" | "bad"; children: ReactNode }) {
  return (
    <span className={`rg-state ${tone}`}>
      <i />
      {children}
    </span>
  );
}

function Pilot({ on, title, sub }: { on: boolean; title: string; sub: string }) {
  return (
    <section className="pilot">
      <span className={`pilot-dot ${on ? "on" : "waiting"}`} />
      <div>
        <div>{title}</div>
        <div className="muted small">{sub}</div>
      </div>
    </section>
  );
}

/** Right-column card « Liste »: a title and a few two-line items. */
function SideList({ title, aside, items }: { title: string; aside?: string; items: { title: string; detail: string }[] }) {
  return (
    <section className="rg-side">
      <header>
        <span>{title}</span>
        {aside && <span className="muted">{aside}</span>}
      </header>
      {items.map((it) => (
        <div key={it.title} className="rg-side-item">
          <span>{it.title}</span>
          <span className="rg-sub">{it.detail}</span>
        </div>
      ))}
    </section>
  );
}

/** Right-column card « Les chiffres »: label, line under it, and a big figure. */
function SideFigures({ title, aside, items }: { title: string; aside?: string; items: { label: string; detail: string; value: string }[] }) {
  return (
    <section className="rg-side">
      <header>
        <span>{title}</span>
        {aside && <span className="muted">{aside}</span>}
      </header>
      {items.map((it) => (
        <div key={it.label} className="rg-figure">
          <span className="rg-text">
            <span>{it.label}</span>
            <span className="rg-sub">{it.detail}</span>
          </span>
          <span className="rg-figure-value">{it.value}</span>
        </div>
      ))}
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
    <Posts>
      <article className="publication rg-post">
        <header className="post-head rg-person">
          <PixelAvatar founder size={48} />
          <span className="rg-text">
            <span className="rg-person-name">{c.founder.name}</span>
            <span className="rg-sub">
              Fondatrice ou fondateur de {c.name}
              {c.legalForm ? ` ${c.legalForm}` : ""}
            </span>
          </span>
        </header>
        <Table>
          <Row as="label" label="Ton prénom" sub="C'est ainsi que l'équipe te nomme">
            <input className="rg-input" value={founderName} onChange={(e) => setFounderName(e.target.value)} />
          </Row>
          <Row as="label" label="Nom de l'entreprise" sub="Dans les messages et les documents">
            <input className="rg-input" value={name} onChange={(e) => setName(e.target.value)} />
          </Row>
          <Row as="label" label="Ville">
            <input className="rg-input" value={city} placeholder="Lille" onChange={(e) => setCity(e.target.value)} />
          </Row>
          <Row label="Forme juridique" sub={c.legalForm ? "Choisie avec Hugo" : "Hugo te la demandera"}>
            <span className={c.legalForm ? "rg-value" : "rg-value muted"}>{c.legalForm ?? "Pas encore choisie"}</span>
          </Row>
        </Table>
        <div className="actions rg-actions">
          <button className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
        </div>
        <Saved {...(message ? { message } : {})} />
      </article>
    </Posts>
  );
}

// ---------- Dépense IA et budget ----------

function todaySpent(state: CompanyState, now: number): number {
  return state.usage.byDay?.[new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)] ?? 0;
}

const sumSince = (events: StoredEvent[], since: number) => events.reduce((s, e) => (e.type === "usage.recorded" && (e.at ?? e.ts) >= since ? s + e.credits : s), 0);

function Budget({ state, status, events, onChange }: { state: CompanyState; status: EngineStatus; events: StoredEvent[]; onChange(): void }) {
  const [acting, setActing] = useState<Mission>();
  const rows = spendByAgent(state, events, status.now - 30 * DAY);
  const month = rows.reduce((s, r) => s + r.credits, 0);
  const text =
    month > 0
      ? `Sur les 30 derniers jours, l'équipe a dépensé ${fmt.dollars(month)} en IA. Je surveille pour toi : chaque tâche a un plafond, et l'équipe s'arrête pour la journée quand le budget du jour est atteint.`
      : "Je surveille la dépense pour toi : chaque tâche a un plafond, et l'équipe s'arrête pour la journée quand le budget du jour est atteint.";
  return (
    <>
      <Pilot on title="Version open source" sub="Tu paies directement ton fournisseur d'IA avec ta clé. Narthex ne prend rien au passage." />
      <Posts>
        <Post state={state} text={text}>
          <Table title="Par agent, sur 30 jours" cols={["Agent", "Ce qui a coûté le plus", "Dépense IA"]} grid="minmax(0, 1.1fr) minmax(0, 1.6fr) 90px">
            {rows.length === 0 && (
              <Cells dim>
                <span>Rien de dépensé sur cette période.</span>
              </Cells>
            )}
            {rows.map((r) => (
              <Cells key={r.agentId}>
                <span>{r.name}</span>
                <span className="muted">{r.top?.title ?? "Échanges entre collègues"}</span>
                <span className="rg-num">{fmt.dollars(r.credits)}</span>
              </Cells>
            ))}
          </Table>
          <Table>
            <Row label="Budget du jour" sub="Au-delà, l'équipe s'arrête jusqu'au lendemain">
              <span className="rg-value">{fmt.dollars(state.settings.dailyBudgetCredits)}</span>
            </Row>
            <Row label="Plafond par tâche" sub="Une tâche qui le dépasse s'arrête, et l'agent le dit dans le Fil">
              <span className="rg-value">{fmt.dollars(state.settings.taskBudgetCredits)}</span>
            </Row>
          </Table>
          <div className="actions rg-actions">
            <button
              className="btn btn-primary"
              onClick={() =>
                setActing({ id: "budget", kind: "budget", eyebrow: "Dépense IA", title: "Ajuster le budget", why: "La dépense IA est facturée sur ton compte, chez ton fournisseur d'IA.", action: "budget", label: "" })
              }
            >
              Ajuster le budget
            </button>
          </div>
        </Post>
      </Posts>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </>
  );
}

function BudgetSide({ state, status, events }: { state: CompanyState; status: EngineStatus; events: StoredEvent[] }) {
  return (
    <>
      <SideFigures
        title="Les chiffres"
        aside="dépense IA"
        items={[
          { label: "Aujourd'hui", detail: `Sur ${fmt.dollars(state.settings.dailyBudgetCredits)} prévus`, value: fmt.dollars(todaySpent(state, status.now)) },
          { label: "Cette semaine", detail: "Les 7 derniers jours", value: fmt.dollars(sumSince(events, status.now - 7 * DAY)) },
          { label: "Depuis le début", detail: "Payé directement à ton fournisseur d'IA", value: fmt.dollars(state.usage.credits) },
        ]}
      />
      <SideList
        title="Si le budget du jour est atteint"
        items={[
          { title: "L'équipe s'arrête", detail: "Rien n'est perdu, elle reprend le lendemain" },
          { title: "Tu gardes la main", detail: "Augmente le budget, et elle repart tout de suite" },
        ]}
      />
    </>
  );
}

// ---------- Notifications ----------

const NOTIFICATIONS: [keyof Config["notifications"], string, string][] = [
  ["legal", "Ce que la loi te réserve", "Une signature, une vérification d'identité, un choix à faire"],
  ["leaving", "Une action va partir", "Un envoi, une publication, un dépôt : tu peux encore l'annuler"],
  ["budget", "Budget du jour atteint", "L'équipe s'arrête jusqu'au lendemain"],
  ["deliverables", "Chaque nouveau livrable", "Une étude, un document, une liste terminée"],
];

function Notifications({ state, config, onSaved }: { state: CompanyState; config: Config; onSaved(): void }) {
  const [n, setN] = useState(config.notifications);
  const toggle = async (k: keyof Config["notifications"]) => {
    const next = { ...n, [k]: !n[k] };
    setN(next);
    await window.narthex.config.setNotifications(next);
    onSaved();
  };
  return (
    <Posts>
      <Post state={state} text="Je ne te dérange que pour ce qui compte. Tout le reste est dans le Fil, quand tu as envie de regarder.">
        <Table cols={["Quoi", "App"]} grid="minmax(0, 1fr) 52px" note="Enregistré dès que tu changes. Pas encore d'e-mail ni de mobile : les notifications passent par l'app.">
          {NOTIFICATIONS.map(([k, title, why]) => (
            <Cells key={k}>
              <span className="rg-text">
                <span>{title}</span>
                <span className="rg-sub">{why}</span>
              </span>
              <span className="rg-center">
                <Switch on={n[k]} label={title} onToggle={() => void toggle(k)} />
              </span>
            </Cells>
          ))}
        </Table>
      </Post>
    </Posts>
  );
}

function NotificationsSide({ config }: { config: Config }) {
  const on = Object.values(config.notifications).filter(Boolean).length;
  return (
    <SideList
      title="Ce que tu reçois"
      items={[
        { title: `${on} sur ${NOTIFICATIONS.length} activées`, detail: "Avec ces réglages" },
        { title: "Seulement en arrière-plan", detail: "Rien ne s'affiche quand l'app est devant toi" },
      ]}
    />
  );
}

// ---------- Autonomie ----------

function Autonomie({ state, onChange }: { state: CompanyState; onChange(): void }) {
  const [hours, setHours] = useState(String(state.settings.cancelWindowHours));
  const [concurrency, setConcurrency] = useState(String(state.settings.concurrency));
  const [topics, setTopics] = useState(state.settings.alwaysAsk);
  const [message, setMessage] = useState<string>();
  const paused = state.company?.paused;
  const save = async () => {
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0) return setMessage("!Donne un nombre d'heures.");
    await window.narthex.call("settings.update", { patch: { cancelWindowHours: h, concurrency: Number(concurrency), alwaysAsk: topics } });
    setMessage("Enregistré. L'équipe suit ces règles dès maintenant.");
    onChange();
  };
  return (
    <>
      <Pilot on={!paused} title={paused ? "L'équipe est en pause" : "L'équipe agit seule dans ces limites"} sub="Tu les fixes une fois, on s'y tient." />
      <Posts>
        <Post state={state} text="Voici les règles qu'on suit. Je te conseille de les garder au début, puis de les desserrer quand tu nous fais confiance.">
          <Table title="Délais et limites">
            <Row label="Délai pour annuler" sub="Entre l'annonce d'une action externe et son départ">
              <Choice
                label="Délai pour annuler"
                value={hours}
                onChange={setHours}
                options={["0", "2", "6", "12", "24", "48", "72"].map((h) => ({ value: h, label: h === "0" ? "Aucun" : `${h} heures` }))}
              />
            </Row>
            <Row label="Agents au travail en même temps" sub="Le budget du jour reste le plafond de dépense">
              <Choice label="Agents au travail en même temps" value={concurrency} onChange={setConcurrency} options={["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v === "1" ? "1 agent" : `${v} agents` }))} />
            </Row>
          </Table>
          <Table title="Toujours me demander avant">
            <p className="rg-sub rg-lead">L'action attend alors le délai d'annulation, même si l'agent a gagné en autonomie.</p>
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
          </Table>
          <div className="actions rg-actions">
            <button className="btn btn-primary" onClick={save}>
              Enregistrer
            </button>
            <button
              className="btn btn-quiet"
              onClick={() => {
                setHours("24");
                setConcurrency("3");
                setTopics(["prix", "publicite-payante"]);
              }}
            >
              Rétablir les conseils de Margaux
            </button>
          </div>
          <Saved {...(message ? { message } : {})} />
        </Post>
        <Post
          state={state}
          text={paused ? "L'équipe est en pause. Les obligations légales restent suivies." : "Si tu dois t'absenter ou si quelque chose ne va pas, tu peux mettre toute l'équipe en pause. Les obligations légales restent suivies."}
        >
          <div className="actions rg-actions">
            <button className="btn btn-secondary" onClick={() => void window.narthex.call(paused ? "company.resume" : "company.pause", {}).then(onChange)}>
              {paused ? "Reprendre" : "Mettre l'équipe en pause"}
            </button>
          </div>
        </Post>
      </Posts>
    </>
  );
}

// ---------- Intégrations ----------

const LATER = [
  ["Guichet unique de l'INPI", "Préparer et suivre l'immatriculation", "Hugo"],
  ["Boîte e-mail", "Envoyer la prospection, avec délai d'annulation", "Samir"],
  ["Facturation électronique", "Émettre et recevoir des factures conformes", "Paul"],
  ["Banque, en lecture seule", "Suivre la trésorerie sans pouvoir payer", "Margaux"],
  ["Réseaux sociaux", "Programmer les publications validées", "Jeanne"],
] as const;

function Integrations({ state }: { state: CompanyState }) {
  type Status = Awaited<ReturnType<typeof window.narthex.discord.get>>;
  const [discord, setDiscord] = useState<Status>();
  const tokenRef = useRef<HTMLInputElement>(null);
  const reload = () => void window.narthex.discord.get().then(setDiscord);
  useEffect(reload, []);
  const who = (names: string[]) => (names.length > 3 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ") || "—");
  const grid = "minmax(0, 0.95fr) minmax(0, 1.5fr) minmax(0, 0.75fr) 96px";
  return (
    <>
      <Pilot on title="L'équipe se sert de ce qui est branché" sub="Rien n'agit à ta place sans délai d'annulation. Discord se débranche à tout moment." />
      <Posts>
        {discord && !discord.connected && (
          <Post
            state={state}
            text="Branche ton Discord et l'équipe y parle aussi : un salon par équipe, chacun sous son nom, des réponses et des réactions. Tu suis la société sans ouvrir l'app. Les réponses entre collègues comptent dans la dépense IA (quelques centimes par jour)."
          >
            <DiscordSetup inputRef={tokenRef} onConnected={reload} />
          </Post>
        )}
        <Post state={state} text="Tout ce que l'équipe utilise, et pour quoi faire. Les services qui agissent pour toi arrivent ensuite, dans l'ordre où ils serviront.">
          <Table title="Branchés" cols={["Service", "Sert à", "Qui", ""]} grid={grid}>
            <Cells>
              <span>Recherche sur le web</span>
              <span className="muted">Trouver et citer des sources</span>
              <span className="muted">{who(toolUsers(state, "web_search"))}</span>
              <State tone="ok">Inclus</State>
            </Cells>
            <Cells>
              <span>Annuaire des entreprises</span>
              <span className="muted">Interroger le registre officiel</span>
              <span className="muted">{who(toolUsers(state, "search_companies"))}</span>
              <State tone="ok">Inclus</State>
            </Cells>
            {discord?.connected && (
              <Cells>
                <span>Discord · {discord.guildName}</span>
                <span className="muted">Un salon par équipe : #général, #décisions…</span>
                <span className="muted">Toute l'équipe</span>
                <span className="rg-end">
                  <button className="btn btn-quiet" onClick={() => void window.narthex.discord.off().then(reload)}>
                    Débrancher
                  </button>
                </span>
              </Cells>
            )}
          </Table>
          {discord?.connected && !discord.ownsEngine && <p className="muted small">L'équipe tourne dans un terminal : relance « narthex lancer » pour qu'elle écrive sur Discord.</p>}
          <Table title="Pas encore branchés" cols={["Service", "Pourquoi", "Qui", ""]} grid={grid}>
            {discord && !discord.connected && (
              <Cells>
                <span>Discord</span>
                <span className="muted">Suivre la société sans ouvrir l'app</span>
                <span className="muted">Toute l'équipe</span>
                <span className="rg-end">
                  <button className="btn btn-secondary" onClick={() => tokenRef.current?.focus()}>
                    Brancher
                  </button>
                </span>
              </Cells>
            )}
            {LATER.map(([name, what, by]) => (
              <Cells key={name}>
                <span>{name}</span>
                <span className="muted">{what}</span>
                <span className="muted">{by}</span>
                <State tone="off">Plus tard</State>
              </Cells>
            ))}
          </Table>
        </Post>
      </Posts>
    </>
  );
}

function IntegrationsSide() {
  const [connected, setConnected] = useState<boolean>();
  useEffect(() => void window.narthex.discord.get().then((s) => setConnected(s.connected)), []);
  const on = 2 + (connected ? 1 : 0);
  return (
    <SideFigures
      title="Les chiffres"
      aside="accès"
      items={[
        { label: "Branchés", detail: "Utilisés par l'équipe", value: String(on) },
        { label: "Pas encore branchés", detail: "Arrivent ensuite", value: String(LATER.length + (connected === false ? 1 : 0)) },
      ]}
    />
  );
}

function DiscordSetup({ inputRef, onConnected }: { inputRef: React.RefObject<HTMLInputElement | null>; onConnected(): void }) {
  const [token, setToken] = useState("");
  const [guilds, setGuilds] = useState<{ id: string; name: string }[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

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
    onConnected();
  };

  return (
    <>
      <Table title="Discord">
        <ol className="steps small rg-steps">
          <li>
            Sur{" "}
            <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
              discord.com/developers
            </a>{" "}
            : New Application, puis Bot, puis Reset Token. Copie le jeton.
          </li>
          <li>OAuth2 · URL Generator : coche « bot », puis Gérer les salons, Gérer les webhooks, Envoyer des messages, Ajouter des réactions, Créer des fils publics. Ouvre l'URL et invite le bot sur ton serveur.</li>
          <li>Colle le jeton ici. Il reste sur ton ordinateur.</li>
        </ol>
        {guilds ? (
          <Row label="Quel serveur ?" sub="Le bot est sur plusieurs serveurs">
            <span className="chips">
              {guilds.map((g) => (
                <button key={g.id} className="chip" onClick={() => void choose(g)}>
                  {g.name}
                </button>
              ))}
            </span>
          </Row>
        ) : (
          <Row label="Jeton du bot" sub="Il reste sur ton ordinateur">
            <input
              ref={inputRef}
              className="rg-input wide"
              type="password"
              value={token}
              placeholder="Colle le jeton"
              aria-label="Jeton du bot Discord"
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && token.trim() && void check()}
            />
          </Row>
        )}
      </Table>
      {!guilds && (
        <div className="actions rg-actions">
          <button className="btn btn-primary" disabled={!token.trim() || busy} onClick={() => void check()}>
            {busy ? "Vérification…" : "Brancher Discord"}
          </button>
        </div>
      )}
      {message && <p className="error small">{message}</p>}
    </>
  );
}

// ---------- API et modèles ----------

const LEVEL_USE: Record<"light" | "standard" | "deep", string> = {
  light: "Vérifier, reformuler, une petite liste",
  standard: "Le travail courant",
  deep: "Le droit, les chiffres, les décisions difficiles",
};

function ApiModels({ state, status, config, events, onChange }: { state: CompanyState; status: EngineStatus; config: Config; events: StoredEvent[]; onChange(): void }) {
  const [acting, setActing] = useState<Mission>();
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(config.models).filter(([, v]) => v)) as Record<string, string>);
  const [levels, setLevels] = useState<Record<string, string>>(() => ({ ...config.levels }));
  const options = (current?: string) => {
    const list = config.choices.map((x) => ({ value: x.id, label: x.label }));
    return current && !list.some((o) => o.value === current) ? [...list, { value: current, label: current }] : list;
  };
  const [message, setMessage] = useState<string>();
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const roles = [...new Set([...agents.map((a) => a.role), ...ROLES.map((r) => r.id)])];
  const week = spendBreakdown(
    state,
    events.filter((e) => e.ts > status.now - 7 * DAY),
  );
  const monthly = (r: string) => Math.round((week.byAgent.filter((a) => a.role === r).reduce((s, a) => s + a.credits, 0) * 30) / 7);
  const total = roles.reduce((s, r) => s + monthly(r), 0);
  const save = async () => {
    await window.narthex.config.setModels(Object.fromEntries(Object.entries(models).filter(([, v]) => v)), levels);
    setMessage(config.ownsEngine ? "Enregistré. Chaque agent utilise son modèle dès sa prochaine étape." : "Enregistré. Il s'appliquera au prochain lancement de l'équipe.");
    onChange();
  };
  const openKey = () =>
    setActing({ id: "key", kind: "key", eyebrow: "API et modèles", title: config.hasKey ? "Remplacer ta clé API" : "Ajoute ta clé API", why: "Elle reste sur ton ordinateur.", action: "key", label: "" });
  return (
    <>
      <Pilot on={config.hasKey || status.runtime === "claude-code"} title="Version open source" sub="Ta clé, chez le fournisseur de ton choix. Chaque agent choisit un modèle léger ou fort selon la tâche ; tu peux lui en imposer un." />
      <Posts>
        <Post state={state} text={`Ta clé reste sur ta machine, Narthex ne l'envoie qu'à ${config.providerLabel}. Pour chaque tâche, l'agent choisit le niveau : léger pour une vérification, approfondi pour le droit ou les chiffres. Une clé OpenRouter donne accès à presque tous les modèles.`}>
          <Table title="Clé du fournisseur" cols={["Fournisseur", "Clé", "État", ""]} grid="minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.9fr) 104px">
            <Cells>
              <span>{config.providerLabel}</span>
              <span className="muted rg-mono">{config.hasKey ? config.keyHint : "—"}</span>
              {config.hasKey ? <State tone="ok">Valide</State> : <State tone="off">Pas de clé</State>}
              <span className="rg-end">
                <button className={config.hasKey ? "btn btn-quiet" : "btn btn-secondary"} onClick={openKey}>
                  {config.hasKey ? "Remplacer" : "Ajouter"}
                </button>
              </span>
            </Cells>
            {status.runtime === "claude-code" && (
              <Cells>
                <span>Claude Code (dev)</span>
                <span className="muted">Ton abonnement claude.ai</span>
                <State tone="ok">Actif</State>
                <span />
              </Cells>
            )}
          </Table>
          <Table title="Modèle par niveau" cols={["Niveau", "Modèle", "Pour"]} grid="minmax(0, 0.7fr) 210px minmax(0, 1fr)">
            {(["light", "standard", "deep"] as const).map((l) => (
              <Cells key={l}>
                <span>{capitalize(LEVEL_LABEL[l])}</span>
                {options(levels[l]).length > 0 ? (
                  <Choice label={`Modèle du niveau ${LEVEL_LABEL[l]}`} wide value={levels[l] ?? ""} onChange={(v) => setLevels({ ...levels, [l]: v })} options={options(levels[l])} />
                ) : (
                  <span className="muted rg-mono">{levels[l] || "—"}</span>
                )}
                <span className="muted small">{LEVEL_USE[l]}</span>
              </Cells>
            ))}
          </Table>
          <Table
            title="Modèle par agent"
            cols={["Agent", "Modèle", "Par mois"]}
            grid="minmax(0, 1fr) 210px 90px"
            note={total > 0 ? `Estimation au rythme des 7 derniers jours : environ ${fmt.dollars(total)} par mois.` : "Pas encore d'estimation : l'équipe n'a rien dépensé ces 7 derniers jours."}
          >
            {roles.map((r) => {
              const agent = agents.find((a) => a.role === r);
              const m = monthly(r);
              return (
                <Cells key={r} dim={!agent}>
                  <span className="with-avatar">
                    <PixelAvatar role={r} size={22} dim={!agent} />
                    {agent?.name ?? role(r).defaultName}
                    <span className="muted small">· {role(r).title}</span>
                  </span>
                  <Choice
                    label={`Modèle de ${agent?.name ?? role(r).defaultName}`}
                    wide
                    value={models[r] ?? ""}
                    onChange={(v) => setModels({ ...models, [r]: v })}
                    options={[{ value: "", label: `Au choix de l'agent (${LEVEL_LABEL[roleLevel(r)]})` }, ...options(models[r])]}
                  />
                  <span className="rg-num muted">{m ? `≈ ${fmt.dollars(m)}` : "—"}</span>
                </Cells>
              );
            })}
          </Table>
          <div className="actions rg-actions">
            <button className="btn btn-primary" onClick={save}>
              Enregistrer
            </button>
            <span className="muted small">« Au choix de l'agent » : il prend le niveau qu'il faut pour chaque tâche.</span>
          </div>
          <Saved {...(message ? { message } : {})} />
        </Post>
      </Posts>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </>
  );
}

function ApiSide({ status, config, events }: { status: EngineStatus; config: Config; events: StoredEvent[] }) {
  const since = status.now - 7 * DAY;
  const calls = events.filter((e) => e.type === "usage.recorded" && (e.at ?? e.ts) >= since).length;
  return (
    <SideFigures
      title="Les chiffres"
      aside="7 derniers jours"
      items={[
        { label: "Dépense IA", detail: `Payée directement à ${config.providerLabel}`, value: fmt.dollars(sumSince(events, since)) },
        { label: "Clés valides", detail: config.providerLabel, value: config.hasKey ? "1 sur 1" : "0 sur 1" },
        { label: "Appels au modèle", detail: "Par toute l'équipe", value: new Intl.NumberFormat("fr-FR").format(calls) },
      ]}
    />
  );
}

// ---------- Membres ----------

function Membres({ state }: { state: CompanyState }) {
  const c = state.company!;
  return (
    <Posts>
      <Post state={state} by={speaker(state, "juridique")} text={`Pour l'instant, Narthex se joue seul : ${c.name}, toi, et l'équipe d'agents. Inviter un associé, un expert-comptable ou un avocat viendra avec la version hébergée.`}>
        <Table title="Personnes" cols={["Nom", "Rôle", "Accès"]} grid="minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)">
          <Cells>
            <span className="with-avatar">
              <PixelAvatar founder size={22} />
              {c.founder.name}
            </span>
            <span className="muted">Fondatrice ou fondateur</span>
            <span className="muted">Tout</span>
          </Cells>
        </Table>
        <div className="actions rg-actions">
          <button className="btn btn-primary" disabled title="Avec la version hébergée">
            Inviter
          </button>
          <span className="muted small">Pas encore disponible</span>
        </div>
      </Post>
    </Posts>
  );
}

// ---------- Sécurité et données ----------

function Securite({ state, config }: { state: CompanyState; config: Config }) {
  const [message, setMessage] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const by = speaker(state, "juridique");
  return (
    <Posts>
      <Post state={state} by={by} text="Tout reste sur ton ordinateur : le journal de l'entreprise, les livrables et ta clé. Rien ne passe par un serveur de Narthex.">
        <Table>
          <Row label="Dossier des données" sub={<span className="rg-mono">{config.dir}</span>} />
          <Row label="Clé API" sub="Dans le fichier de configuration, lisible par ton seul compte">
            {config.hasKey ? <State tone="ok">Enregistrée</State> : <State tone="off">Pas de clé</State>}
          </Row>
          <Row label="Connexion entre l'app et le terminal" sub="Locale uniquement, réservée à ton compte ; rien n'écoute sur le réseau">
            <State tone="ok">Locale</State>
          </Row>
        </Table>
      </Post>
      <Post state={state} by={by} text="Tes données t'appartiennent. Tu peux tout récupérer en un fichier, à tout moment.">
        <div className="actions rg-actions">
          <button
            className="btn btn-secondary rg-icon-btn"
            onClick={() =>
              void window.narthex.data
                .export()
                .then((f) => setMessage(`Exporté : ${f}`))
                .catch((e: unknown) => setMessage(`!${cleanError(e)}`))
            }
          >
            <Download /> Exporter l'entreprise
          </button>
        </div>
        <Saved {...(message ? { message } : {})} />
      </Post>
      <Post
        state={state}
        by={by}
        text="Tu veux repartir de zéro ? Toutes tes entreprises sont rangées dans les archives (rien n'est supprimé) et le premier lancement recommence. Pour en créer juste une autre, passe par le menu en haut à gauche."
      >
        <div className="actions rg-actions">
          {confirm ? (
            <>
              <button className="btn btn-danger" onClick={() => void window.narthex.data.restart().catch((e: unknown) => setMessage(`!${cleanError(e)}`))}>
                Archiver et recommencer
              </button>
              <button className="btn btn-quiet" onClick={() => setConfirm(false)}>
                Annuler
              </button>
            </>
          ) : (
            <button className="btn btn-quiet" onClick={() => setConfirm(true)}>
              Recommencer
            </button>
          )}
        </div>
      </Post>
    </Posts>
  );
}

const Download = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17.5 12.5v3.33a1.67 1.67 0 0 1-1.67 1.67H4.17a1.67 1.67 0 0 1-1.67-1.67V12.5M5.83 8.33 10 12.5l4.17-4.17M10 12.5v-10" />
  </svg>
);

// ---------- Right column ----------

function WeekStats({ state, now, events }: { state: CompanyState; now: number; events: StoredEvent[] }) {
  const week = events.filter((e) => e.ts > now - 7 * DAY);
  const done = week.filter((e) => e.type === "task.completed").length;
  const cancelled = week.filter((e) => e.type === "task.cancelled" && e.by === "founder").length;
  const spent = week.filter((e) => e.type === "usage.recorded").reduce((s, e) => s + (e as { credits: number }).credits, 0);
  return (
    <SideList
      title="Cette semaine"
      items={[
        { title: `${done} mission${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} seule${done > 1 ? "s" : ""}`, detail: "Dans les limites fixées" },
        { title: `${cancelled} annulée${cancelled > 1 ? "s" : ""} par toi`, detail: "Tu peux toujours le faire" },
        { title: `${fmt.dollars(spent)} de dépense IA`, detail: `Plafond : ${fmt.dollars(state.settings.dailyBudgetCredits)} par jour` },
      ]}
    />
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

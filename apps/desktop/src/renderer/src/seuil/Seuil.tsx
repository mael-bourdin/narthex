import { useEffect, useRef, useState } from "react";
import { onboardingTeam, SEUIL, type FirstLook, type Finding } from "@narthex/core";
import { Ambiance, type AmbiancePhase } from "./Ambiance.tsx";
import { Door, type DoorState } from "./Door.tsx";
import { Findings } from "./Findings.tsx";
import { Speech } from "./Speech.tsx";
import { TeamReveal } from "./TeamReveal.tsx";
import { TypeLine } from "./TypeLine.tsx";
import { WhatsAppChoice, WhatsAppQr } from "./WhatsAppStep.tsx";
import "./seuil.css";

const SKIP = Symbol("skip");
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, reduced() ? Math.min(ms, 300) : ms));

interface Scene {
  door: DoorState;
  ambiance: AmbiancePhase;
  /** `id` remounts the speech, so the same sentence said twice (a second bad key) still plays. */
  say?: { id: number; text: string; aside?: string; raised?: boolean };
  input?: { masked: boolean };
  status?: string;
  skip?: boolean;
  findings?: Finding[];
  team?: { dimmed: boolean };
  enter?: boolean;
  whatsapp?: "choose" | { risk: string };
}

/**
 * The first launch, as one script: Margaux speaks, the founder answers into the light.
 * Nothing is created until the company name is given (spec: « le seuil »).
 */
export function Seuil({ onDone }: { onDone: () => void }) {
  const [scene, setScene] = useState<Scene>({ door: "idle", ambiance: "hidden" });
  const spoken = useRef<() => void>(() => {});
  const answered = useRef<(v: string | typeof SKIP) => void>(() => {});
  const looked = useRef<() => void>(() => {});
  const chose = useRef<(connect: boolean) => void>(() => {});
  const started = useRef(false);
  const lines = useRef(0);
  // The team shown is the one Margaux chose for this idea (from her first look).
  const [team, setTeam] = useState(() => onboardingTeam());

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const set = (patch: Partial<Scene>) => setScene((s) => ({ ...s, ...patch }));
    const say = (text: string, extra: { aside?: string; raised?: boolean } = {}) =>
      new Promise<void>((resolve) => {
        spoken.current = resolve;
        set({ say: { id: ++lines.current, text, ...extra } });
      });
    const ask = (masked = false, skip = false) =>
      new Promise<string | typeof SKIP>((resolve) => {
        answered.current = (v) => {
          set({ input: undefined, skip: false });
          resolve(v);
        };
        set({ input: { masked }, skip });
      });

    const script = async () => {
      await wait(400);
      set({ door: "drawing" });
      await wait(3300);
      set({ door: "through", ambiance: "on" });
      await wait(1500);

      const needsKey = await window.narthex.onboarding.needsKey();
      await say(SEUIL.hello);
      await wait(900);
      if (needsKey) {
        await say(SEUIL.askKey, { aside: SEUIL.keyAside });
        for (;;) {
          const key = await ask(true, true);
          if (key === SKIP) {
            await say(SEUIL.noKeyYet);
            await wait(600);
            await say(SEUIL.askNameNoKey);
            break;
          }
          set({ status: SEUIL.checking, skip: true });
          const skipped = new Promise<typeof SKIP>((resolve) => (answered.current = () => resolve(SKIP)));
          const check = await Promise.race([window.narthex.onboarding.submitKey(key), skipped]);
          set({ status: undefined, skip: false });
          if (check === SKIP) {
            await say(SEUIL.noKeyYet);
            await wait(600);
            await say(SEUIL.askNameNoKey);
            break;
          }
          if (check.ok) {
            set({ ambiance: "awake" });
            await wait(1100);
            if (!check.applied) await say("Clé enregistrée. Elle servira dès que l'équipe sera relancée.");
            await say(SEUIL.askName);
            break;
          }
          await say(check.message);
        }
      } else {
        await say(SEUIL.askNameNoKey);
      }

      const name = (await ask()) as string;
      await say(SEUIL.askIdea(name));
      const idea = (await ask()) as string;

      const look: Promise<FirstLook> = window.narthex.call("onboarding.firstLook", { idea, founderName: name });
      set({ ambiance: "calm" });
      await say(SEUIL.searching, { raised: true });
      const result = await look;
      const chosen = onboardingTeam(result);
      setTeam(chosen);
      if (result.findings.length > 0) {
        await say(result.reaction, { raised: true });
        await new Promise<void>((resolve) => {
          looked.current = resolve;
          set({ findings: result.findings });
        });
      } else {
        await say(result.reaction, { raised: true });
        await wait(1200);
      }

      set({ findings: undefined, ambiance: "on" });
      await say(SEUIL.team, { raised: true });
      set({ team: { dimmed: false } });
      await wait(1300 * (chosen.now.length + chosen.later.length) + 600);

      set({ team: { dimmed: true } });
      await say(SEUIL.askCompany, { raised: true });
      for (;;) {
        const company = (await ask()) as string;
        try {
          await window.narthex.call("company.found", { name: company, idea, founderName: name, firstLook: result });
          set({ team: { dimmed: false } });
          await say(SEUIL.welcome(company), { raised: true });
          break;
        } catch (e) {
          await say(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e), { raised: true });
        }
      }
      // WhatsApp, right away: the founder can follow the team without opening the app.
      set({ team: undefined });
      await say(SEUIL.askWhatsApp, { raised: true });
      const connect = await new Promise<boolean>((resolve) => {
        chose.current = resolve;
        set({ whatsapp: "choose" });
      });
      set({ whatsapp: undefined });
      if (connect) {
        const wa = await window.narthex.whatsapp.get();
        if (!wa.installed) await say(wa.install, { raised: true, aside: SEUIL.whatsAppLater });
        else {
          set({ whatsapp: { risk: wa.risk } });
          const linked = await window.narthex.whatsapp.pair();
          set({ whatsapp: undefined });
          await say(linked.ok ? `C'est branché. Je t'écris sur WhatsApp, dans tes messages à toi-même (+${linked.phone}).` : `${linked.message} ${SEUIL.whatsAppLater}`, { raised: true });
        }
      } else await say(SEUIL.whatsAppLater, { raised: true });

      set({ door: "small" });
      await wait(900);
      set({ enter: true });
    };
    // A failure (unreadable config, engine gone) is said in Margaux's voice instead of freezing the screen.
    script().catch((e: unknown) => {
      set({ input: undefined, status: undefined, findings: undefined, say: { id: ++lines.current, text: `Quelque chose s'est mal passé : ${e instanceof Error ? e.message : String(e)}. Relance Narthex.` } });
    });
    // The script runs once; `team` only feeds the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="seuil">
      <div className="seuil-drag" />
      <Ambiance phase={scene.ambiance} />
      <Door state={scene.door} />
      {scene.say && <Speech key={scene.say.id} text={scene.say.text} aside={scene.say.aside} raised={scene.say.raised} onDone={() => spoken.current()} />}
      {scene.input && <TypeLine masked={scene.input.masked} onSubmit={(v) => answered.current(v)} />}
      {scene.status && <p className="seuil-status">{scene.status}</p>}
      {scene.findings && <Findings items={scene.findings} onDone={() => looked.current()} />}
      {scene.team && <TeamReveal now={team.now} later={team.later} dimmed={scene.team.dimmed} />}
      {scene.skip && (
        <button className="seuil-skip" onClick={() => answered.current(SKIP)}>
          {SEUIL.skipKey}
        </button>
      )}
      {scene.whatsapp === "choose" && <WhatsAppChoice onChoose={(c) => chose.current(c)} />}
      {scene.whatsapp && scene.whatsapp !== "choose" && <WhatsAppQr risk={scene.whatsapp.risk} onCancel={() => void window.narthex.whatsapp.cancel()} />}
      {scene.enter && (
        <button className="seuil-enter" autoFocus onClick={onDone}>
          {SEUIL.enter}
        </button>
      )}
    </div>
  );
}

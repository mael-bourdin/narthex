import { useEffect, useMemo, useRef, useState } from "react";
import { bureauDialogue, filView, role, type BureauDialogue, type CompanyState, type EngineStatus, type Mission } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { PixelSprite } from "./PixelAvatar.tsx";
import "./bureau.css";

/**
 * The Bureau (Figma 157:7265): the team at their desks, seen from above.
 * It shows the real work: whoever works types with a bubble, whoever waits on the founder has a « ! ».
 * Arrows or ZQSD / WASD to walk, Space to talk.
 */

const T = 32; // one tile, in room pixels
const W = 22;
const H = 13;
type Rect = { x: number; y: number; w: number; h: number };

const SHELVES: Rect[] = [
  { x: 2, y: 2, w: 1, h: 1 },
  { x: 3, y: 2, w: 1, h: 1 },
  { x: 17, y: 2, w: 1, h: 1 },
  { x: 18, y: 2, w: 1, h: 1 },
];
const PLANTS: Rect[] = [
  { x: 7, y: 2, w: 1, h: 1 },
  { x: 14, y: 2, w: 1, h: 1 },
  { x: 2, y: 10, w: 1, h: 1 },
  { x: 19, y: 10, w: 1, h: 1 },
];
const RUG: Rect = { x: 7, y: 7.4, w: 8, h: 2.6 };

function desksFor(n: number): Rect[] {
  const count = Math.max(n, 1);
  const span = 16;
  return Array.from({ length: count }, (_, i) => ({ x: 3 + Math.round(((i + 0.5) * span) / count) - 1, y: 5.2, w: 2, h: 1 }));
}

function blocked(x: number, y: number, obstacles: Rect[]): boolean {
  if (x < 1.3 || x > W - 1.3 || y < 2.6 || y > H - 1.4) return true;
  return obstacles.some((r) => x > r.x - 0.35 && x < r.x + r.w + 0.35 && y > r.y - 0.2 && y < r.y + r.h + 0.5);
}

export function Bureau({ state, status, onAgent, onChange }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void; onChange(): void }) {
  const view = filView(state, status.now);
  const team = view.team;
  const desks = useMemo(() => desksFor(team.length), [team.length]);
  const obstacles = useMemo(() => [...desks, ...SHELVES, ...PLANTS], [desks]);
  const homes = team.map((r, i) => ({ id: r.agent.id, x: desks[i]!.x + 1, y: desks[i]!.y - 1.1, row: r }));

  const [me, setMe] = useState({ x: W / 2, y: H - 1.8, step: 0 as 0 | 1, left: false });
  const [talk, setTalk] = useState<{ dialogue: BureauDialogue; shown: number; choice: number }>();
  const [acting, setActing] = useState<Mission>();
  const keys = useRef(new Set<string>());
  const frame = useRef(0);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  // You can talk to someone from beside them or from the front of their desk.
  const near = homes.find((h, i) => Math.hypot(h.x - me.x, h.y - me.y) < 1.9 || Math.hypot(h.x - me.x, desks[i]!.y + 1.6 - me.y) < 1.3);

  // Fit the room in the page.
  useEffect(() => {
    const fit = () => setScale(Math.min(1.35, ((box.current?.clientWidth ?? W * T) - 2) / (W * T)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Walking.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const k = keys.current;
      const dx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
      const dy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
      if ((dx || dy) && !talk && !acting) {
        const speed = 4.2 * dt;
        frame.current += dt;
        setMe((m) => {
          const nx = m.x + dx * speed;
          const ny = m.y + dy * speed;
          return {
            x: blocked(nx, m.y, obstacles) ? m.x : nx,
            y: blocked(m.x, ny, obstacles) ? m.y : ny,
            step: (Math.floor(frame.current * 7) % 2) as 0 | 1,
            left: dx ? dx < 0 : m.left,
          };
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [obstacles, talk, acting]);

  // Keyboard: arrows, ZQSD (AZERTY), WASD (QWERTY), Space / Enter to talk and choose, Escape to leave.
  useEffect(() => {
    const dir = (e: KeyboardEvent) =>
      ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", z: "up", w: "up", s: "down", q: "left", a: "left", d: "right" })[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (acting || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const d = dir(e);
      if (talk) {
        const options = talk.dialogue.options;
        if (e.key === "Escape") setTalk(undefined);
        else if (d === "up" || d === "down") setTalk({ ...talk, choice: (talk.choice + (d === "down" ? 1 : options.length - 1)) % options.length });
        else if (e.key === " " || e.key === "Enter") {
          if (talk.shown < talk.dialogue.text.length) setTalk({ ...talk, shown: talk.dialogue.text.length });
          else choose(options[talk.choice]!);
        }
        e.preventDefault();
        return;
      }
      if (d) {
        keys.current.add(d);
        e.preventDefault();
      }
      if ((e.key === " " || e.key === "Enter") && near) {
        setTalk({ dialogue: bureauDialogue(state, near.id, status.now, status.runtime), shown: 0, choice: 0 });
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const d = dir(e);
      if (d) keys.current.delete(d);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // choose is stable enough for this listener's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk, near, acting, state, status]);

  // Letters appear one by one, like a dialogue box in a game.
  useEffect(() => {
    if (!talk || talk.shown >= talk.dialogue.text.length) return;
    const t = setTimeout(() => setTalk((v) => (v ? { ...v, shown: v.shown + 2 } : v)), 22);
    return () => clearTimeout(t);
  }, [talk]);

  function choose(option: BureauDialogue["options"][number]) {
    setTalk(undefined);
    if (option.mission) setActing(option.mission);
    else if (option.agent) onAgent(option.agent);
  }

  const speaker = talk ? state.agents[talk.dialogue.speakerId] : undefined;
  const waitingIds = new Set(homes.filter((h) => bureauDialogue(state, h.id, status.now, status.runtime).waiting).map((h) => h.id));

  return (
    <div className="bureau-page" ref={box}>
      <div className="bureau-frame" style={{ width: W * T * scale, height: H * T * scale }}>
        <div className="bureau" style={{ width: W * T, height: H * T, transform: `scale(${scale})` }}>
          <div className="room-wall" />
          {[3, 7.5, 13.5, 18].map((x) => (
            <span key={x} className="window" style={{ left: x * T, top: 0.45 * T }} />
          ))}
          <div className="room-floor" style={{ left: T, top: 2 * T, width: (W - 2) * T, height: (H - 3) * T }} />
          <span className="door" style={{ left: 10 * T, top: (H - 1) * T, width: 2 * T }} />
          <span className="rug" style={{ left: RUG.x * T, top: RUG.y * T, width: RUG.w * T, height: RUG.h * T }} />
          {SHELVES.map((r, i) => (
            <span key={`s${i}`} className="shelf" style={{ left: r.x * T, top: r.y * T }} />
          ))}
          {PLANTS.map((r, i) => (
            <span key={`p${i}`} className="plant" style={{ left: r.x * T, top: r.y * T }} />
          ))}
          {homes.map((h, i) => {
            const r = h.row;
            const working = r.status === "working";
            const fresh = status.now - r.agent.hiredAt < 10 * 60_000;
            return (
              <div key={h.id}>
                <div className={`agent${working ? " working" : ""}${r.status === "idle" ? " idle" : ""}`} style={{ left: h.x * T - 13, top: h.y * T - 34 }}>
                  {waitingIds.has(h.id) && <span className="bang">!</span>}
                  {working && !waitingIds.has(h.id) && <span className="bubble">{(r.current?.progress && r.current.progress !== "Au travail…" ? r.current.progress : r.current?.title ?? "").slice(0, 42)}</span>}
                  {fresh && !working && !waitingIds.has(h.id) && <span className="bubble fresh">Nouvelle recrue</span>}
                  <PixelSprite role={r.agent.role} size={36} />
                  <span className="nameplate">{r.agent.name}</span>
                </div>
                <span className="desk" style={{ left: desks[i]!.x * T, top: desks[i]!.y * T }}>
                  <span className={`screen${working ? " on" : ""}`} />
                </span>
              </div>
            );
          })}
          <div className={`agent me${me.left ? " left" : ""}`} style={{ left: me.x * T - 13, top: me.y * T - 34 }}>
            <PixelSprite founder size={36} step={me.step} />
          </div>
          {near && !talk && (
            <span className="hint" style={{ left: near.x * T - 44, top: (desks[homes.indexOf(near)]!.y + 1.05) * T }}>
              Espace pour parler
            </span>
          )}
          {talk && (
            <div className="dialog">
              <span className="dialog-name">
                {speaker?.name} · {speaker ? role(speaker.role).title : ""}
              </span>
              <p>{talk.dialogue.text.slice(0, talk.shown)}</p>
              {talk.shown >= talk.dialogue.text.length && (
                <ul className="dialog-choices">
                  {talk.dialogue.options.map((o, i) => (
                    <li key={o.label} className={i === talk.choice ? "on" : ""} onMouseEnter={() => setTalk({ ...talk, choice: i })} onClick={() => choose(o)}>
                      {o.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="bureau-help muted small">Flèches ou ZQSD pour te déplacer · Espace pour parler · un ! signale qui t'attend</p>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { bureauDialogue, filView, officeOf, role, type CompanyState, type EngineStatus, type Mission } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { officeLayout, seatAgents, type Floor, type Rect } from "./bureau-layouts.ts";
import { PixelSprite } from "./PixelAvatar.tsx";
import "./bureau.css";

/**
 * The Bureau (Figma 157:7265): the team at work, seen from above, in an office that grows with the
 * company (a run-down little house first, a tower with a view at the end; core `OFFICES`).
 * It shows the real work: whoever works types with a bubble, whoever waits on the founder has a « ! ».
 * Arrows or ZQSD / WASD to walk, Space to talk, and to take the elevator in the tower.
 */

const T = 32; // one tile, in room pixels

type Talk = {
  name: string;
  text: string;
  shown: number;
  choice: number;
  options: { label: string; mission?: Mission; agent?: string; floor?: number }[];
};

function blocked(x: number, y: number, floor: Floor, obstacles: Rect[]): boolean {
  if (x < 1.3 || x > floor.W - 1.3 || y < 2.6 || y > floor.H - 1.4) return true;
  return obstacles.some((r) => x > r.x - 0.35 && x < r.x + r.w + 0.35 && y > r.y - 0.2 && y < r.y + r.h + 0.5);
}

export function Bureau({ state, status, onAgent, onChange }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void; onChange(): void }) {
  const view = filView(state, status.now);
  const team = view.team;
  const office = officeOf(state);
  const floors = useMemo(() => officeLayout(office.tier, team.length), [office.tier, team.length]);
  const seats = useMemo(() => seatAgents(floors, team.map((r) => r.agent.role)), [floors, team]);
  const [floorIndex, setFloorIndex] = useState(0);
  const floor = floors[Math.min(floorIndex, floors.length - 1)]!;
  const here = team.map((r, i) => ({ row: r, ...seats[i]! })).filter((h) => h.floor === Math.min(floorIndex, floors.length - 1));
  const obstacles = useMemo(() => [...here.flatMap((h) => (h.seat.desk ? [h.seat.desk] : [])), ...floor.decos.filter((d) => d.solid).map((d) => d.r)], [here, floor]);

  const start = () => ({ x: floor.door ? floor.door.x + 1 : floor.W / 2, y: floor.H - 1.8, step: 0 as 0 | 1, left: false });
  const [me, setMe] = useState(start);
  const [talk, setTalk] = useState<Talk>();
  const [acting, setActing] = useState<Mission>();
  const keys = useRef(new Set<string>());
  const frame = useRef(0);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  // A move to a better office puts the founder at the new door.
  useEffect(() => {
    setFloorIndex(0);
    setMe(start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office.tier]);

  // You can talk to someone from beside them or from the front of their desk; the elevator from its doors.
  const near = here.find((h) => Math.hypot(h.seat.x - me.x, h.seat.y - me.y) < 1.9 || (h.seat.desk && Math.hypot(h.seat.x - me.x, h.seat.desk.y + 1.6 - me.y) < 1.3));
  const atElevator = floor.elevator && Math.hypot(floor.elevator.x + floor.elevator.w / 2 - me.x, floor.elevator.y + floor.elevator.h + 0.9 - me.y) < 1.4;

  // Fit the room in the page.
  useEffect(() => {
    const fit = () => setScale(Math.min(1.35, ((box.current?.clientWidth ?? floor.W * T) - 2) / (floor.W * T)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [floor.W]);

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
            x: blocked(nx, m.y, floor, obstacles) ? m.x : nx,
            y: blocked(m.x, ny, floor, obstacles) ? m.y : ny,
            step: (Math.floor(frame.current * 7) % 2) as 0 | 1,
            left: dx ? dx < 0 : m.left,
          };
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [obstacles, floor, talk, acting]);

  const open = (): Talk | undefined => {
    if (atElevator) {
      return {
        name: "Ascenseur",
        text: "Quel étage ?",
        shown: 0,
        choice: 0,
        options: [...floors.map((f, i) => ({ label: f.name, floor: i })), { label: "Rester ici" }],
      };
    }
    if (!near) return undefined;
    const d = bureauDialogue(state, near.row.agent.id, status.now, status.runtime);
    const speaker = state.agents[d.speakerId];
    return { name: speaker ? `${speaker.name} · ${role(speaker.role).title}` : "", text: d.text, shown: 0, choice: 0, options: d.options };
  };

  // Keyboard: arrows, ZQSD (AZERTY), WASD (QWERTY), Space / Enter to talk and choose, Escape to leave.
  useEffect(() => {
    const dir = (e: KeyboardEvent) =>
      ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", z: "up", w: "up", s: "down", q: "left", a: "left", d: "right" })[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (acting || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const d = dir(e);
      if (talk) {
        const options = talk.options;
        if (e.key === "Escape") setTalk(undefined);
        else if (d === "up" || d === "down") setTalk({ ...talk, choice: (talk.choice + (d === "down" ? 1 : options.length - 1)) % options.length });
        else if (e.key === " " || e.key === "Enter") {
          if (talk.shown < talk.text.length) setTalk({ ...talk, shown: talk.text.length });
          else choose(options[talk.choice]!);
        }
        e.preventDefault();
        return;
      }
      if (d) {
        keys.current.add(d);
        e.preventDefault();
      }
      if (e.key === " " || e.key === "Enter") {
        const t = open();
        if (t) {
          setTalk(t);
          e.preventDefault();
        }
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
    // choose and open are stable enough for this listener's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk, near, atElevator, acting, state, status, floor]);

  // Letters appear one by one, like a dialogue box in a game.
  useEffect(() => {
    if (!talk || talk.shown >= talk.text.length) return;
    const t = setTimeout(() => setTalk((v) => (v ? { ...v, shown: v.shown + 2 } : v)), 22);
    return () => clearTimeout(t);
  }, [talk]);

  function choose(option: Talk["options"][number]) {
    setTalk(undefined);
    if (option.floor !== undefined && option.floor !== floorIndex) {
      // Out of the elevator on the chosen floor.
      const target = floors[option.floor]!;
      setFloorIndex(option.floor);
      setMe((m) => ({ ...m, x: target.elevator ? target.elevator.x + target.elevator.w / 2 : m.x, y: target.elevator ? target.elevator.y + target.elevator.h + 1 : m.y }));
    } else if (option.mission) setActing(option.mission);
    else if (option.agent) onAgent(option.agent);
  }

  const waitingIds = new Set(here.filter((h) => bureauDialogue(state, h.row.agent.id, status.now, status.runtime).waiting).map((h) => h.row.agent.id));
  const W = floor.W;
  const H = floor.H;

  return (
    <div className="bureau-page" ref={box}>
      <div className="bureau-title">
        <span>{floor.name}</span>
        {floors.length > 1 && <span className="muted small">· {floors.length} étages</span>}
      </div>
      <div className="bureau-frame" style={{ width: W * T * scale, height: H * T * scale }}>
        <div className={`bureau ${floor.theme}`} style={{ width: W * T, height: H * T, transform: `scale(${scale})` }}>
          <div className="room-wall" />
          {floor.windows.map((w, i) => (
            <span key={i} className={`window ${w.kind ?? ""}`} style={{ left: w.x * T, top: w.kind === "tall" || w.kind === "pano" ? 0.25 * T : 0.45 * T, width: w.kind ? w.w * T : undefined }} />
          ))}
          <div className="room-floor" style={{ left: T, top: 2 * T, width: (W - 2) * T, height: (H - 3) * T }} />
          {floor.door && <span className="door" style={{ left: floor.door.x * T, top: (H - 1) * T, width: floor.door.w * T }} />}
          {floor.elevator && (
            <span className="elevator" style={{ left: floor.elevator.x * T, top: floor.elevator.y * T, width: floor.elevator.w * T, height: floor.elevator.h * T }}>
              <span className="elevator-floor">{floorIndex === 0 ? "RDC" : floorIndex}</span>
            </span>
          )}
          {floor.rug && <span className="rug" style={{ left: floor.rug.x * T, top: floor.rug.y * T, width: floor.rug.w * T, height: floor.rug.h * T }} />}
          {floor.decos.map((d, i) => (
            <span key={i} className={`deco ${d.kind}`} style={{ left: d.r.x * T, top: d.r.y * T, width: d.r.w * T, height: d.r.h * T }} />
          ))}
          {here.map((h) => {
            const r = h.row;
            const working = r.status === "working";
            const fresh = status.now - r.agent.hiredAt < 10 * 60_000;
            return (
              <div key={r.agent.id}>
                <div className={`agent${working ? " working" : ""}${r.status === "idle" ? " idle" : ""}`} style={{ left: h.seat.x * T - 13, top: h.seat.y * T - 34 }}>
                  {waitingIds.has(r.agent.id) && <span className="bang">!</span>}
                  {working && !waitingIds.has(r.agent.id) && <span className="bubble">{(r.current?.progress && r.current.progress !== "Au travail…" ? r.current.progress : r.current?.title ?? "").slice(0, 42)}</span>}
                  {fresh && !working && !waitingIds.has(r.agent.id) && <span className="bubble fresh">Nouvelle recrue</span>}
                  <PixelSprite role={r.agent.role} size={36} />
                  <span className="nameplate">{r.agent.name}</span>
                </div>
                {h.seat.desk && (
                  <span className="desk" style={{ left: h.seat.desk.x * T, top: h.seat.desk.y * T }}>
                    <span className={`screen${working ? " on" : ""}`} />
                  </span>
                )}
              </div>
            );
          })}
          <div className={`agent me${me.left ? " left" : ""}`} style={{ left: me.x * T - 13, top: me.y * T - 34 }}>
            <PixelSprite founder size={36} step={me.step} />
          </div>
          {!talk && atElevator && (
            <span className="hint" style={{ left: floor.elevator!.x * T - 130, top: (floor.elevator!.y + floor.elevator!.h + 0.2) * T }}>
              Espace pour l'ascenseur
            </span>
          )}
          {!talk && !atElevator && near && (
            <span className="hint" style={{ left: near.seat.x * T - 44, top: ((near.seat.desk?.y ?? near.seat.y) + 1.05) * T }}>
              Espace pour parler
            </span>
          )}
          {talk && (
            <div className="dialog">
              <span className="dialog-name">{talk.name}</span>
              <p>{talk.text.slice(0, talk.shown)}</p>
              {talk.shown >= talk.text.length && (
                <ul className="dialog-choices">
                  {talk.options.map((o, i) => (
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
      <p className="bureau-help muted small">
        Flèches ou ZQSD pour te déplacer · Espace pour parler{floor.elevator ? " ou prendre l'ascenseur" : ""} · un ! signale qui t'attend
      </p>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { fmt, STAGE_LABEL, type CompanySummary } from "@narthex/core";
import { Logo } from "./ui.tsx";

/** « narthex · Maison Lumen » : every company of the founder, all running; one is shown. */
export function CompanySwitcher({ current, onSwitch, onCreate }: { current: string; onSwitch(): void; onCreate(): void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<CompanySummary[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void window.narthex.call("companies.list", {}).then(setList);
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="brand switcher" ref={box}>
      <button className="switcher-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Logo />
        <span>narthex</span>
        <span className="muted">·</span>
        <span className="switcher-name">{current}</span>
        <span className="muted switcher-caret">▾</span>
      </button>
      {open && (
        <div className="switcher-menu" role="menu">
          <p className="muted small">Tes entreprises · toutes continuent de tourner</p>
          {list.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              className={c.active ? "switcher-item on" : "switcher-item"}
              onClick={async () => {
                setOpen(false);
                if (!c.active) {
                  await window.narthex.call("company.select", { companyId: c.id });
                  onSwitch();
                }
              }}
            >
              <span>{c.name}</span>
              <span className="muted small">
                {STAGE_LABEL[c.stage]} · {fmt.dollars(c.spent)}
              </span>
            </button>
          ))}
          <button
            role="menuitem"
            className="switcher-item create"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            + Créer une autre entreprise
          </button>
        </div>
      )}
    </div>
  );
}

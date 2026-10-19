/** The row of section links under the top bar (Figma: « Organigramme · Calendrier · … »). */
export function SectionTabs<T extends string>({ items, active, onSelect }: { items: readonly T[]; active: T; onSelect(item: T): void }) {
  return (
    <nav className="section-tabs">
      {items.map((item) => (
        <button key={item} className={item === active ? "on" : ""} onClick={() => onSelect(item)}>
          {item}
        </button>
      ))}
    </nav>
  );
}

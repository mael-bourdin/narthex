export type DoorState = "idle" | "drawing" | "through" | "small";

/** The seuil, Figma « Logo / Symbole » (135:7): drawn stroke by stroke, light rising inside, then crossed. */
export function Door({ state }: { state: DoorState }) {
  return (
    <svg className={`seuil-door ${state}`} viewBox="0 0 96 96" aria-hidden>
      <defs>
        <radialGradient id="seuil-light" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(48.7 91.5) scale(57.9)">
          <stop stopColor="white" />
          <stop offset=".4" stopColor="#CFC8FF" />
          <stop offset="1" stopColor="#5B4FD1" stopOpacity=".12" />
        </radialGradient>
        <radialGradient id="seuil-halo" cx=".5" cy=".9" r=".6">
          <stop stopColor="#CFC8FF" stopOpacity=".45" />
          <stop offset="1" stopColor="#5B4FD1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="halo" cx="48" cy="80" rx="46" ry="30" fill="url(#seuil-halo)" />
      <path
        className="light"
        d="M27.29 87.75V43.66C27.29 37.99 29.55 32.54 33.57 28.52C37.58 24.51 43.03 22.25 48.71 22.25C54.38 22.25 59.83 24.51 63.85 28.52C67.86 32.54 70.12 37.99 70.12 43.66V87.75H27.29Z"
        fill="url(#seuil-light)"
      />
      <path className="stroke" d="M25.88 86.12V46.98C25.88 40.63 28.21 34.55 32.36 30.06C36.51 25.58 42.13 23.06 48 23.06C53.87 23.06 59.49 25.58 63.64 30.06C67.79 34.55 70.12 40.63 70.12 46.98V86.12" />
      <path className="stroke base" d="M15 88H81" />
    </svg>
  );
}

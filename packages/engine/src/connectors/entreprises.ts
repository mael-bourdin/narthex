/**
 * API Recherche d'entreprises (DINUM): open, free, no key, 7 requests per second.
 * Used to check whether a name is taken (obligation A1) and to find real prospects.
 * https://recherche-entreprises.api.gouv.fr/docs/
 *
 * Only what a company sheet needs comes back: no directors' names (personal data, GDPR minimisation).
 */

export interface CompanySearch {
  /** Name, brand or keywords. */
  q?: string;
  code_postal?: string;
  departement?: string;
  /** NAF code, e.g. 47.91B. */
  activite_principale?: string;
}

export interface CompanyHit {
  siren: string;
  nom: string;
  enseignes: string[];
  activite: string;
  creation: string;
  active: boolean;
  commune: string;
  codePostal: string;
  /** Public sheet on annuaire-entreprises.data.gouv.fr, citable as a source. */
  fiche: string;
}

export interface CompanySearchResult {
  total: number;
  results: CompanyHit[];
}

type Fetch = (url: string, init: { signal?: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const BASE = "https://recherche-entreprises.api.gouv.fr/search";
/** Under the API's 7 requests per second, shared by every agent of this process. */
const MIN_GAP_MS = 160;
let nextSlot = 0;

async function politely(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

export async function searchCompanies(search: CompanySearch, deps: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<CompanySearchResult> {
  const params = new URLSearchParams({ per_page: "10" });
  for (const key of ["q", "code_postal", "departement", "activite_principale"] as const) {
    const v = search[key]?.trim();
    if (v) params.set(key, v.slice(0, 200));
  }
  if (params.size === 1) throw new Error("Donne au moins un critère : un nom, un code postal, un département ou un code NAF.");
  await politely();
  const res = await (deps.fetch ?? (fetch as unknown as Fetch))(`${BASE}?${params}`, {
    signal: deps.signal ?? AbortSignal.timeout(10_000),
    headers: { accept: "application/json", "user-agent": "Narthex (recherche d'entreprises)" },
  });
  if (!res.ok) throw new Error(`L'annuaire des entreprises ne répond pas (${res.status}). Réessaie plus tard.`);
  const body = (await res.json()) as { total_results?: unknown; results?: unknown };
  const results = Array.isArray(body.results) ? body.results : [];
  return {
    total: typeof body.total_results === "number" ? body.total_results : results.length,
    results: results.flatMap((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const siege = (o.siege ?? {}) as Record<string, unknown>;
      if (typeof o.siren !== "string" || !/^\d{9}$/.test(o.siren)) return [];
      const text = (v: unknown) => (typeof v === "string" ? v : "");
      return [
        {
          siren: o.siren,
          nom: text(o.nom_complet),
          enseignes: Array.isArray(siege.liste_enseignes) ? siege.liste_enseignes.filter((e): e is string => typeof e === "string") : [],
          activite: text(o.activite_principale),
          creation: text(o.date_creation),
          active: o.etat_administratif === "A",
          commune: text(siege.libelle_commune),
          codePostal: text(siege.code_postal),
          fiche: `https://annuaire-entreprises.data.gouv.fr/entreprise/${o.siren}`,
        },
      ];
    }),
  };
}

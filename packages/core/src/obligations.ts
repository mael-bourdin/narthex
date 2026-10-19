import type { LegalForm, ObligationOwner, Stage } from "./types.ts";

/**
 * French legal checklist, encoded as data (R-PARAMÈTRES: dated, reviewed every January and July).
 * Source: Narthex legal research, verified 2026-10-17 (checklist phases A–D). See docs/LEGAL.md.
 */
export interface ObligationRule {
  code: string;
  title: string;
  why: string;
  owner: ObligationOwner;
  /** The obligation opens once the company reaches this stage… */
  opensAt: Stage;
  /** …and every obligation listed here is done. */
  requires?: string[];
  /** Days after opening before it is due. */
  dueInDays?: number;
  /** Only for these legal forms (all when omitted). */
  forms?: LegalForm[];
  legalBasis?: string;
}

const SOCIETES: LegalForm[] = ["SASU", "SAS", "EURL", "SARL"];

export const LEGAL_CHECKLIST_VERSION = "2026-10-17";

export const OBLIGATIONS: readonly ObligationRule[] = [
  {
    code: "A1-nom",
    title: "Vérifier que le nom est libre",
    why: "Marques INPI, registre national des entreprises et nom de domaine, avant de tout imprimer.",
    owner: "juridique",
    opensAt: "creation",
    dueInDays: 7,
  },
  {
    code: "A2-activite-reglementee",
    title: "Vérifier si l'activité est réglementée",
    why: "Diplôme, carte pro ou assurance obligatoire : tant que ce n'est pas vérifié, on ne crée rien.",
    owner: "juridique",
    opensAt: "creation",
    dueInDays: 7,
  },
  {
    code: "A3-forme",
    title: "Choisir la forme juridique",
    why: "Hugo présente les options et leurs conséquences, c'est toi qui choisis.",
    owner: "founder",
    opensAt: "creation",
    requires: ["A2-activite-reglementee"],
    dueInDays: 7,
  },
  {
    code: "B1-statuts",
    title: "Préparer les statuts",
    why: "À partir d'un modèle, chaque clause choisie par toi.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["A3-forme"],
    dueInDays: 5,
    forms: SOCIETES,
  },
  {
    code: "B2-depot-capital",
    title: "Déposer le capital",
    why: "La banque ou le notaire délivre le certificat de dépôt demandé pour l'immatriculation.",
    owner: "founder",
    opensAt: "creation",
    requires: ["B1-statuts"],
    dueInDays: 15,
    forms: SOCIETES,
    legalBasis: "C. com. art. L227-1 et L223-7",
  },
  {
    code: "B5-signer-statuts",
    title: "Signer les statuts",
    why: "La loi exige la signature de la présidente ou du gérant.",
    owner: "founder",
    opensAt: "creation",
    requires: ["B1-statuts"],
    dueInDays: 3,
    forms: SOCIETES,
  },
  {
    code: "B3-annonce-legale",
    title: "Publier l'annonce légale",
    why: "Dans un journal habilité du département du siège ; on garde l'attestation de parution.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["B5-signer-statuts"],
    dueInDays: 5,
    forms: SOCIETES,
  },
  {
    code: "B4-immatriculation",
    title: "Immatriculer l'entreprise sur le guichet unique",
    why: "Formalité obligatoire et exclusive sur le guichet unique de l'INPI depuis 2023.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["B3-annonce-legale", "B2-depot-capital", "B4-identite"],
    dueInDays: 10,
  },
  {
    code: "B4-identite",
    title: "Vérifier ton identité sur le guichet unique",
    why: "Le dirigeant doit vérifier lui-même son identité avant la formalité.",
    owner: "founder",
    opensAt: "creation",
    requires: ["A3-forme"],
    dueInDays: 10,
  },
  {
    code: "B6-facturation-electronique",
    title: "Choisir une plateforme agréée de facturation électronique",
    why: "Toute entreprise assujettie à la TVA doit pouvoir recevoir des factures électroniques depuis le 1er septembre 2026.",
    owner: "comptable",
    opensAt: "launch",
    dueInDays: 30,
  },
  {
    code: "B7-rc-pro",
    title: "Comparer et souscrire une RC Pro",
    why: "Obligatoire pour certaines activités, prudente pour toutes.",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 30,
  },
  {
    code: "B8-mentions-legales",
    title: "Mentions légales, confidentialité et cookies du site",
    why: "Obligatoires dès que le site est en ligne (LCEN, CNIL).",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 14,
  },
  {
    code: "C5-cfe",
    title: "Déposer le formulaire 1447-C-SD (CFE)",
    why: "Avant le 31 décembre de l'année de création, pour profiter de l'exonération de la première année.",
    owner: "comptable",
    opensAt: "launch",
    dueInDays: 60,
  },
  {
    code: "C10-rgpd",
    title: "Tenir le registre des traitements (RGPD)",
    why: "Dès qu'on garde des données de clients ou de prospects.",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 30,
  },
];

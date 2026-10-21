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
    title: "Check that the name is free",
    why: "INPI trademarks, the national business register (RNE) and the domain name, before anything gets printed.",
    owner: "juridique",
    opensAt: "creation",
    dueInDays: 7,
  },
  {
    code: "A2-activite-reglementee",
    title: "Check whether the activity is regulated",
    why: "A required diploma, professional card or insurance: until this is checked, nothing gets created.",
    owner: "juridique",
    opensAt: "creation",
    dueInDays: 7,
  },
  {
    code: "A3-forme",
    title: "Choose the legal form",
    why: "Hugo lays out the options and what each one means for you. You choose.",
    owner: "founder",
    opensAt: "creation",
    requires: ["A2-activite-reglementee"],
    dueInDays: 7,
  },
  {
    code: "B1-statuts",
    title: "Prepare the articles of association (statuts)",
    why: "From a template, with every clause chosen by you.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["A3-forme"],
    dueInDays: 5,
    forms: SOCIETES,
  },
  {
    code: "B2-depot-capital",
    title: "Deposit the share capital",
    why: "The bank or the notary issues the deposit certificate that registration asks for.",
    owner: "founder",
    opensAt: "creation",
    requires: ["B1-statuts"],
    dueInDays: 15,
    forms: SOCIETES,
    legalBasis: "Code de commerce, art. L227-1 and L223-7",
  },
  {
    code: "B5-signer-statuts",
    title: "Sign the articles of association",
    why: "The law requires the signature of the company's president (SAS, SASU) or manager, the gérant (SARL, EURL).",
    owner: "founder",
    opensAt: "creation",
    requires: ["B1-statuts"],
    dueInDays: 3,
    forms: SOCIETES,
  },
  {
    code: "B3-annonce-legale",
    title: "Publish the legal notice (annonce légale)",
    why: "In a newspaper authorised for legal notices in the head office's département. Keep the proof of publication.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["B5-signer-statuts"],
    dueInDays: 5,
    forms: SOCIETES,
  },
  {
    code: "B4-immatriculation",
    title: "Register the company on the guichet unique",
    why: "A mandatory filing, done only on the INPI guichet unique (the single online portal for business formalities) since 2023.",
    owner: "juridique",
    opensAt: "creation",
    requires: ["B3-annonce-legale", "B2-depot-capital", "B4-identite"],
    dueInDays: 10,
  },
  {
    code: "B4-identite",
    title: "Verify your identity on the guichet unique",
    why: "The company's director has to verify their own identity before the filing.",
    owner: "founder",
    opensAt: "creation",
    requires: ["A3-forme"],
    dueInDays: 10,
  },
  {
    code: "B6-facturation-electronique",
    title: "Choose an approved e-invoicing platform",
    why: "Since 1 September 2026, every business subject to VAT (TVA) must be able to receive electronic invoices.",
    owner: "comptable",
    opensAt: "launch",
    dueInDays: 30,
  },
  {
    code: "B7-rc-pro",
    title: "Compare and take out professional liability insurance (RC Pro)",
    why: "Mandatory for some activities, wise for all of them.",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 30,
  },
  {
    code: "B8-mentions-legales",
    title: "Write the website's legal notices, privacy policy and cookie banner",
    why: "Mandatory as soon as the website is online (LCEN, CNIL).",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 14,
  },
  {
    code: "C5-cfe",
    title: "File form 1447-C-SD (CFE)",
    why: "Before 31 December of the year the company is created, to get the first-year exemption from the CFE, the local business tax.",
    owner: "comptable",
    opensAt: "launch",
    dueInDays: 60,
  },
  {
    code: "C10-rgpd",
    title: "Keep the record of processing activities (GDPR, RGPD)",
    why: "As soon as the company keeps data about customers or prospects.",
    owner: "juridique",
    opensAt: "launch",
    dueInDays: 30,
  },
];

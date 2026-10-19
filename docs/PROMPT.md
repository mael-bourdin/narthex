# Prompt de développement — Narthex

> À donner tel quel à un agent de code (Claude Code ou autre) au début de chaque session de développement sur ce dépôt. Il remplace toute explication orale. Tenu à jour avec le code : si une règle ici contredit le code, c'est ce fichier qu'on corrige en premier, dans la même PR.

---

## 1. Ce que tu construis

Narthex est un jeu où une équipe d'agents IA crée et fait tourner une **vraie** entreprise française pour quelqu'un qui n'a qu'une idée.

- Le joueur raconte son idée. **Margaux**, sa co-fondatrice IA, monte l'équipe au moment où l'entreprise en a besoin (recherche, juridique, prospection, rédaction, vidéo, comptabilité, service client).
- Les agents **décident seuls** de ce qu'il faut faire, le font, et publient leur travail dans le **Fil** à la première personne, avec un livrable sourcé.
- Le joueur **ne lance jamais de mission**. Il regarde, peut **annuler** une action externe pendant un délai (24 h par défaut), et n'agit lui-même **que pour ce que la loi lui réserve** (signer les statuts, vérifier son identité, choisir sa forme juridique, déposer le capital).
- Le travail est réel : statuts, études de marché, prospection, factures conformes. Le droit français est encodé en données (`packages/core/src/obligations.ts`).

Promesse de marque : *« Tu as l'idée. On a l'équipe. »* L'ennemi, c'est la paperasse qui fait détester leur métier aux entrepreneurs.

Deux portes d'entrée : **open source** (ce dépôt, licence MIT, le joueur apporte sa clé API) et plus tard une **version hébergée** avec crédits. Le cœur doit rester le même pour les deux.

## 2. Contraintes non négociables

1. **Multiplateforme** : macOS (arm64, x64) et Windows (x64, arm64) sont des cibles de première classe ; Linux suit. Aucun chemin en dur, aucune commande shell propre à un OS, aucune dépendance native qui ne compile pas sur Windows. Les chemins passent par `node:path`, les dossiers de données par `packages/engine/src/paths.ts`, le transport local par un socket Unix ou un *named pipe* Windows (`socketPath()`).
2. **Le CLI seul suffit** : tout ce que fait l'app de bureau doit être faisable avec `narthex` dans un terminal. Une fonctionnalité n'est pas finie tant qu'elle n'a pas son équivalent CLI (commande ou rendu texte). L'app et le CLI sont deux clients du **même moteur** et du **même protocole**.
3. **Les agents sont autonomes** : pas de bouton « lancer une mission », pas de « choisis ton coéquipier », pas de validation systématique. Seules exceptions : les actions externes (délai d'annulation) et ce que la loi réserve au fondateur.
4. **Jamais de dépense surprise, jamais de faux travail** : le mode Claude ne s'active que si le joueur l'a choisi (`narthex config mode anthropic` ou clé enregistrée pour Narthex). Une variable `ANTHROPIC_API_KEY` exportée ne suffit pas. Sans clé, personne ne travaille : l'équipe planifie et attend, le Fil reste vide. La simulation (`NARTHEX_RUNTIME=simulation`) et Claude Code (`NARTHEX_RUNTIME=claude-code`, l'abonnement claude.ai du développeur, vérifié via `claude auth status`, sans clé API) servent au développement et aux tests, jamais au joueur : Anthropic n'autorise pas un produit tiers à proposer la connexion claude.ai. Ne jamais l'exposer dans l'onboarding, les Réglages ni la configuration enregistrée.
5. **Honnêteté** : chaque fait, chiffre ou règle vient avec sa source datée. Les agents disent qu'ils sont des IA (AI Act, art. 50). Les livrables simulés disent qu'ils sont simulés.
6. **Lignes rouges légales** (voir `docs/LEGAL.md`) : pas de conseil juridique personnalisé (loi de 1971, art. 54), pas d'arrêté des comptes pour autrui (ordonnance de 1945), pas de tri automatisé de CV (AI Act, annexe III), pas de facture B2B en simple PDF quand l'émission électronique est obligatoire, prospection B2B conforme CNIL.

## 3. Architecture

```
packages/core     Domaine pur. Types, événements, projection, rôles, règles (policy), obligations légales,
                  protocole, vues (sélecteurs), formats FR. Aucune entrée/sortie, aucune dépendance.
packages/engine   Moteur Node. Journal d'événements SQLite (node:sqlite), boucle de l'entreprise (Engine),
                  runtimes d'agents (AnthropicRuntime, SimulationRuntime), serveur local JSON lines,
                  clients (InProcessClient, SocketClient), config, chemins par OS.
apps/cli          `narthex` : commandes + rendus texte (render.ts). Empaqueté en un seul fichier (esbuild).
apps/desktop      Electron + React. Le processus principal rejoint un moteur qui tourne déjà
                  (`narthex lancer`) ou en lance un et le sert au CLI. Le rendu ne parle qu'au protocole.
```

Flux d'une décision :

```
état (projection des événements)
   └─► policy.decide(state, now)  →  intentions (recruter, ouvrir une obligation, prévoir, démarrer…)
          └─► Engine.applyIntent  →  événements (append-only)  →  nouvel état  →  clients notifiés
                 └─► runtime.run(tâche)  →  livrable + message du Fil + suites prévues (guardTask)
```

Règles d'architecture :

- **Tout changement d'état est un `DomainEvent`** (`core/events.ts`), appliqué par le seul reducer `apply` (`core/projection.ts`). On n'édite jamais un événement passé ; on en ajoute un.
- **Toute décision d'organisation vit dans `core/policy.ts`** (qui recruter, quand changer d'étape, quoi prévoir, quand démarrer, quand une action doit attendre). Jamais dans l'UI, jamais dans un runtime. `decide()` est pure et idempotente.
- **Une nouvelle méthode d'API** : l'ajouter à `Methods` (`core/protocol.ts`), puis au `switch` de `Engine.dispatch`, puis au CLI, puis à l'app.
- **Une nouvelle obligation légale** : une ligne dans `OBLIGATIONS` avec son code de checklist, sa source, son étape et ses prérequis. Pas de code.
- **Un nouveau rôle** : une entrée dans `ROLES` (fiche de poste : mission, outils, garde-fous, effort) et une règle dans `HIRING`.
- **Exécution plate** : l'organigramme est une interface de jeu, pas une pile d'appels. Orchestration de profondeur ≤ 2.
- **Prompts** : préfixe stable et mis en cache (outils → identité et règles du rôle → fiche entreprise), contenu volatil (date, tâche) à la fin. Ne jamais mettre d'horodatage dans le préfixe.
- **Modèle par défaut** : `claude-opus-5-5`, effort par rôle, `fallbacks: "default"` côté serveur. Configurable par `narthex config modele`.

## 4. Conventions

- TypeScript strict, ESM, imports avec extension `.ts`, syntaxe effaçable seulement (`erasableSyntaxOnly` : pas d'`enum`, pas de propriétés de paramètres de constructeur).
- Identifiants en anglais, **textes visibles en français** : tutoiement, phrases courtes, majuscule en début de phrase seulement, pas de capitales espacées, pas d'emoji, pas de jargon (« crédits », pas « tokens »). Les agents parlent à la première personne.
- Commentaires en anglais, rares, sur le *pourquoi*.
- Node ≥ 24, npm workspaces. Pas de dépendance native (node:sqlite est intégré à Node et à Electron).
- Tests avec Vitest, à côté du paquet (`packages/*/test`, `apps/*/test`). Le moteur se teste en simulation avec `SimulatedClock` : jamais d'appel réseau dans les tests.

## 5. Design

Source de vérité : Figma, fichier `ddJerA4yBlmhqVVeJSaMQs` — pages « Narthex — Design book », « Components », « App », « Narthex — Parcours ».

- Sombre, épuré, beaucoup d'air. Une seule police : **Geist**.
- Couleurs de base : Nuit `#0B0C16`, Encre `#1A1C2B`, Ardoise `#5B6075`, Brume `#A9ADBD`, Pierre `#E6E4DD`. La couleur vient des quatre **ambiances** en dégradés flous (Braise de minuit, Aurore, Floraison violette, Éclipse).
- Mise en page de toutes les pages : barre du haut (Fil · Bureau · Équipe · Entreprise), colonne centrale 736 px + colonne droite 320 px. Pas de barre latérale façon SaaS.
- La **pancarte** en dégradé est réservée aux actions que la loi impose au fondateur.
- Les tableaux sont des pièces jointes dans les messages des agents.
- Le **Bureau** est une vue en pixel art vue de dessus façon Pokémon : chaque agent actif est un personnage dont la bulle montre le travail en cours. C'est une visualisation de l'exécution réelle, pas un décor.

## 6. Feuille de route

Cocher dans ce fichier au fil des PR.

**v0.1 — Fondations (fait)**
- [x] Domaine : événements, projection, rôles, recrutement par étape, obligations FR, garde-fous, délai d'annulation, autonomie gagnée.
- [x] Moteur : SQLite, boucle, reprise après crash, retries avec backoff, simulation hors ligne, runtime Claude (outils stricts, web search/fetch, cache, fallback).
- [x] Serveur local multiplateforme + clients ; CLI complet ; app Electron (premier lancement, Fil, Équipe).
- [x] CI macOS / Windows / Linux.

**v0.2 — Jouable de bout en bout avec de vrais agents**
- [x] Premier lancement « le seuil » (app et `narthex init`) : porte traversée, Margaux qui parle mot à mot, clé du fournisseur demandée en version open source, premier coup d'œil sourcé, équipe, nom, puis le Fil. Conception : `docs/superpowers/specs/2026-10-19-onboarding-seuil-design.md`.
- [x] Fil au format Figma, nourri par les vraies données : durées réelles, XP (règle `xpFor`), sources, équipe et heures de la semaine, quête de l'étape, livrables en Markdown (tableaux), clé ajoutable depuis le Fil.
- [x] Livrables : page plein écran à sections, export `.md` depuis le CLI (`livrable --fichier`) et l'app. Reste : `.pdf`.
- [x] Budget : dépense IA comptée à chaque appel au modèle ; plafond par tâche (1,50 $ par défaut, la tâche s'arrête et l'agent le dit) et par jour (3 $ par défaut, plus rien ne démarre, la pancarte le dit et permet de l'ajuster). Le joueur voit toujours la dépense IA en dollars, jamais en « crédits » (unité interne : le centime).
- [x] Escalade : après `MAX_ATTEMPTS` échecs, l'obligation est « bloquée », Margaux prévient une seule fois, la pancarte propose « Réessayer » (`narthex reessayer`).
- [ ] Mémoire L2/L3 : faits extraits des livrables (asynchrone, petit modèle), recherche dans le journal (« pourquoi a-t-on décidé X ? »).
- [ ] Vérificateur : seconde passe sur les livrables juridiques et chiffrés (sources vérifiées, liens vivants).
- [x] Calendrier jour / semaine / mois dans l'app ; Organigramme ; Recrutements prévus ; Journal.
- [x] Modèle par rôle (Opus où l'erreur coûte cher, Sonnet ou Haiku ailleurs) ; mode développement `NARTHEX_RUNTIME=claude-code` (abonnement du développeur, jamais proposé aux joueurs).

**v0.3 — Le jeu**
- [x] Bureau en pixel art, personnages, bulles en direct, « ! » sur ce qui attend le fondateur, dialogues.
- [x] Onglet Entreprise (Vue d'ensemble, Finances, Ventes, Marketing, Obligations) au format du Fil.
- [x] Notifications système (macOS, Windows) pour les obligations, les actions qui partent bientôt, le budget et les blocages.
- [x] Réglages : autonomie, délais, plafonds, sujets « toujours me demander », pause.

**v0.4 — Le monde réel**
- [ ] Connecteurs : guichet unique INPI (préparation du dossier), API Recherche d'entreprises, envoi d'e-mails (avec délai), plateforme agréée de facturation électronique, banque (lecture).
- [ ] Signature électronique des statuts.
- [ ] Distribution : installeurs signés et notarisés (macOS), signés (Windows), mise à jour automatique ; paquet npm `narthex` pour le CLI.

**Plus tard** : version hébergée (PostgreSQL derrière `EventStore`, comptes, crédits), mobile, multi-entreprises.

## 7. Définition de « fini »

Une PR est prête quand :

1. `npm run typecheck` et `npm test` passent (la CI le vérifie sur macOS, Windows et Linux).
2. La fonctionnalité existe dans le CLI **et** dans l'app (ou l'app est explicitement hors périmètre, écrit dans la PR).
3. Les règles nouvelles sont dans `core/policy.ts` ou en données, avec un test.
4. Les textes sont en français, au ton de la marque ; rien ne prétend être fait si ce n'est pas fait.
5. Aucun appel réseau, aucune dépense, aucune écriture hors du dossier de données sans action explicite du joueur.
6. Ce fichier et `docs/ARCHITECTURE.md` sont à jour si l'architecture a bougé.

## 8. Pour démarrer une session

```bash
npm install
npm test
NARTHEX_RUNTIME=simulation npm run narthex -- init --idee "…" --prenom Inès --nom "Maison Lumen"   # agents d'exemple, hors ligne
NARTHEX_RUNTIME=claude-code npm run narthex -- lancer   # vrais agents via ton Claude Code (abonnement), développement seulement
npm run dev:desktop
```

Lis `docs/ARCHITECTURE.md`, puis le code de `packages/core/src/policy.ts` et `packages/engine/src/engine.ts` : tout le reste en découle. Avant de coder une tâche de la feuille de route, écris en trois lignes ce que tu vas changer dans le domaine, le moteur, le CLI et l'app.

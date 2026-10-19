# Narthex — notes pour les agents de code

Lis d'abord `docs/PROMPT.md` : produit, contraintes (macOS + Windows, CLI complet, agents autonomes, pas de dépense surprise), architecture, conventions, feuille de route, définition de « fini ».

- Décisions → `packages/core/src/policy.ts`. État → événements (`core/events.ts`) + `apply` (`core/projection.ts`).
- Nouvelle méthode → `core/protocol.ts`, `Engine.dispatch`, CLI, app.
- Vérifier : `npm run typecheck && npm test`. Essayer : `NARTHEX_HOME=$(mktemp -d) npm run narthex -- init`.
- Capture de l'app sans enregistrement d'écran : `NARTHEX_SNAPSHOT=out.png npx electron apps/desktop` après `npm run build -w @narthex/desktop`.

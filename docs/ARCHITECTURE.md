# Architecture

## Vue d'ensemble

```
┌──────────────┐   ┌───────────────┐
│  apps/cli    │   │ apps/desktop  │      deux clients, un seul protocole (core/protocol.ts)
│  narthex …   │   │ Electron+React│
└──────┬───────┘   └───────┬───────┘
       │ JSON lines sur socket local (Unix) / named pipe (Windows), ou en mémoire
┌──────▼───────────────────▼───────┐
│ packages/engine                  │
│  Engine ── policy.decide ──► intentions ──► événements
│     │                                          │
│     └─ AgentRuntime (Claude | simulation)      ▼
│                                   SqliteEventStore (append-only)
└──────────────────────────────────┘
┌──────────────────────────────────┐
│ packages/core (pur)              │ types · events · projection · policy · roles
│                                  │ obligations · protocol · views · format
└──────────────────────────────────┘
```

## Le journal d'événements

Une partie, c'est un fichier SQLite (`narthex.sqlite`) qui contient la liste des événements de l'entreprise, dans l'ordre. L'état affiché est toujours la projection de ce journal (`replay`). Conséquences :

- rien n'est perdu ni réécrit : le Journal de l'app est le journal lui-même ;
- après un crash, le moteur rejoue le journal et marque comme interrompues les tâches qui tournaient ;
- une version hébergée remplacera `SqliteEventStore` par un store PostgreSQL derrière la même interface.

## La boucle

`Engine.tick()` appelle `decide(state, now)` jusqu'à ce qu'il n'y ait plus rien à décider. Les intentions possibles :

| Intention | Quand |
|---|---|
| `advance-stage` | idée → étude → création → lancement → en activité, selon ce qui a été livré ou fait |
| `hire` | le rôle est utile à cette étape (`HIRING`) |
| `open-obligation` | l'étape est atteinte, la forme juridique correspond, les prérequis sont faits |
| `plan-task` | première mission d'un nouvel agent, ou obligation d'équipe à traiter (avec backoff après échec) |
| `fulfill-obligation` | la tâche correspondante est faite |
| `start-task` | l'heure est venue, le délai d'annulation est passé, l'agent est libre, il reste de la place |

Toute tâche passe par `guardTask` : les actions externes attendent le délai d'annulation (raccourci quand l'agent a gagné en autonomie), les sujets « toujours me demander » comptent comme externes, ce qui revient au fondateur est refusé, et la file de chaque agent est plafonnée.

## Les runtimes

- `SimulationRuntime` : agents scriptés, hors ligne, déterministes. Pour essayer sans clé, pour les tests, pour développer l'interface.
- `AnthropicRuntime` : API Messages, un préfixe stable et mis en cache par rôle (outils, identité, garde-fous, fiche entreprise), puis la tâche. Outils : `web_search`, `web_fetch` (serveur), `publish_deliverable`, `plan_task`, `post_progress`, `update_memory` (stricts, entrées revalidées). Le dernier texte de l'agent devient son message dans le Fil. Usage converti en crédits (1 crédit = 0,01 $).

## Multiplateforme

| | macOS | Windows | Linux |
|---|---|---|---|
| Données | `~/Library/Application Support/Narthex` | `%APPDATA%\Narthex` | `$XDG_DATA_HOME/narthex` |
| Transport local | socket Unix dans le dossier de données | named pipe propre à l'utilisateur | socket Unix |
| App | `.dmg` (arm64, x64) | installeur NSIS (x64, arm64) | AppImage |

`NARTHEX_HOME` remplace le dossier de données (tests, installation portable).

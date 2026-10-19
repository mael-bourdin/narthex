# Narthex

**Tu as l'idée. On a l'équipe.**

Narthex est un jeu où une équipe d'agents IA crée et fait tourner une vraie entreprise pour toi. Tu racontes ton idée ; Margaux, ta co-fondatrice IA, fait venir les bons coéquipiers au bon moment (recherche, juridique, prospection, rédaction, comptabilité…). Ils décident seuls de ce qu'il faut faire, le font, et te le racontent dans le Fil. Toi, tu regardes, tu peux annuler une action avant qu'elle parte, et tu ne fais que ce que la loi te réserve : signer, vérifier ton identité, choisir ta forme juridique.

> *English: Narthex is an open-source game where a team of AI agents founds and runs a real French company for you. Desktop app for macOS and Windows, and a full command-line version. MIT licensed.*

Statut : **v0.1, en développement actif.** Le droit encodé est le droit français.

## Essayer

Il faut [Node.js 24](https://nodejs.org) ou plus récent, sur macOS, Windows ou Linux.

```bash
git clone https://github.com/mael-bourdin/narthex.git
cd narthex
npm install
npm run narthex -- init        # Margaux t'accueille, te demande ta clé et ton idée, puis l'équipe se met au travail
```

Au premier lancement, Margaux te demande ta clé API Anthropic : c'est ce qui lui permet de penser. Elle reste sur ton ordinateur. Sans clé, l'équipe prépare tout et attend : rien n'est inventé, le Fil reste vide. Tu peux ajouter ta clé plus tard, dans le Fil ou avec `npm run narthex -- config cle`.

Avec ta clé, l'équipe dépense par défaut au plus 3 $ par jour et 1,50 $ par tâche ; une tâche qui dépasse s'arrête, et au-delà du budget du jour plus rien ne démarre avant le lendemain. Ajuste-les dans l'app (pancarte) ou avec `narthex config budget <crédits>` et `narthex config budget-tache <crédits>` (1 crédit = 0,01 $).

Narthex n'utilise jamais une clé `ANTHROPIC_API_KEY` exportée sans que tu l'aies choisi (`narthex config mode anthropic`) : pas de dépense surprise. Pour développer sans clé, `NARTHEX_RUNTIME=simulation` fait tourner des agents d'exemple hors ligne.

## Tout en ligne de commande

```
narthex init                      Le premier lancement : ta clé, ton idée, ton équipe
narthex lancer                    Fait travailler l'équipe (Fil en direct)
narthex fil                       Ce que l'équipe a fait, ce qui t'attend
narthex equipe                    Qui fait quoi en ce moment
narthex calendrier [--semaine]    Les tâches du jour ou de la semaine
narthex obligations               Les obligations légales, les tiennes en premier
narthex journal                   Toutes les actions, dans l'ordre
narthex livrable <id|dernier>     Lire un livrable
narthex valider <id>              Dire que tu as fait une obligation
narthex annuler <id>              Annuler une action prévue
narthex pause | reprendre
```

`narthex --aide` pour tout le reste. Chaque commande accepte `--json`.

Pour l'installer comme commande : `npm run build:cli`, puis `npm link -w @narthex/cli`.

## L'app de bureau

```bash
npm run dev:desktop                       # développement
npm run dist:mac -w @narthex/desktop      # .dmg
npm run dist:win -w @narthex/desktop      # installeur .exe
```

L'app et le terminal partagent la même entreprise : si `narthex lancer` tourne, l'app le rejoint ; sinon l'app fait tourner l'équipe et le terminal la rejoint.

## Comment c'est fait

Un domaine pur (`packages/core`), un moteur à journal d'événements (`packages/engine`), deux clients (`apps/cli`, `apps/desktop`). Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Pour contribuer, ou pour faire travailler un agent de code sur le projet : [docs/PROMPT.md](docs/PROMPT.md) et [CONTRIBUTING.md](CONTRIBUTING.md).

## Limites

Narthex prépare et dépose ; il ne remplace ni un avocat ni un expert-comptable, et te le dit quand une question en demande un. Voir [docs/LEGAL.md](docs/LEGAL.md).

## Licence

[MIT](LICENSE).

# Premier lancement : « Le seuil »

*Conception validée en conversation le 19 octobre 2026. Remplace le formulaire actuel de l'app (`Onboarding.tsx`) et le `narthex init` à questions. Remplace aussi le parcours pixel art de la page Figma « Premier lancement », qui est abandonné.*

Maquette animée de référence : `.superpowers/brainstorm/*/content/concepts.html` (scène A, ouverture) et `seuil-v2.html` (déroulé complet).

## Pourquoi

Le fondateur a jugé le formulaire actuel « horrible » : pas d'animation, un fond sans caractère, rien qui donne l'impression qu'une IA est là, « pas dingue ». Les premières minutes doivent donner le frisson : on franchit un seuil (le narthex) et, de l'autre côté, une intelligence vivante nous parle, nous écoute et se met au travail sous nos yeux.

## Objectifs

- On sent qu'une IA est présente et vivante : elle parle mot à mot, elle réagit à ce que tu dis, elle travaille devant toi avec ses sources.
- Le mouvement et la lumière portent l'émotion. L'ambiance en dégradés flous respire en permanence.
- En moins de deux minutes, l'entreprise existe, l'équipe est là et on arrive dans le Fil.
- Version open source : la clé du fournisseur de LLM est demandée avant que Margaux puisse penser.
- La même expérience existe en ligne de commande, adaptée au terminal.

## Non-objectifs

- La version hébergée (crédits, comptes). On prévoit seulement que l'étape « clé » disparaît dans ce cas.
- Plusieurs fournisseurs de LLM : seul Anthropic est branché aujourd'hui (voir « Laissé au constructeur »).
- Le mobile.

## Anti-objectifs (échec même si ça marche)

- Ça ressemble à un formulaire : champs encadrés, libellés, bouton « Suivant ».
- C'est une animation de façade : en mode Claude, ce que Margaux dit sur l'idée et ce qu'elle trouve doivent être réels et sourcés.
- Ça bascule en mode Claude ou dépense des crédits sans que le joueur ait fourni sa clé dans ce parcours (règle « pas de dépense surprise »).
- Ça casse la DA : néon, dégradé violet-cyan, capitales espacées, police mono décorative, emoji.

## Le déroulé (décidé avec le fondateur)

Plein écran, sans barre du haut ni bouton « Suivant » : c'est la conversation qui fait avancer.

1. **Seuil.** Écran noir. Le vrai logo (composant Figma « Logo / Symbole », 135:7 : arche et marche, dégradé radial blanc → lavande `#CFC8FF` → `#5B4FD1`) se dessine trait par trait, en trait fin comme dans la première maquette. La lumière monte dans la porte, de bas en haut. Puis la caméra traverse la porte (zoom très fort, fondu) et l'on arrive dans l'ambiance **Braise de minuit** en couleurs : blobs flous bleu nuit `#1c2353`, prune `#5b2860`, rose `#c4607f`, champagne `#f0cfa0`, en mélange *screen*, qui dérivent lentement, avec un grain animé. Le mouvement de cette ouverture doit être **exactement** celui de la scène A de `concepts.html`. Le fondateur l'a préférée à la v2.
2. **Clé** (seulement s'il n'y a pas de clé enregistrée pour Narthex) :
   - Margaux : « Bonsoir. Je suis Margaux, ta future co-fondatrice. » puis « Pour penser, j'ai besoin d'une clé. Colle ta clé API Anthropic. », et en petit en dessous : « Elle reste sur ton ordinateur. Tu peux la retirer quand tu veux. »
   - Le joueur colle sa clé directement sur le fond : curseur seul, aucun champ visible. Elle s'affiche masquée (les 11 premiers caractères, puis des points), suivie de « Vérification… » avec un point qui pulse.
   - Si la clé est valide, un éclat de lumière part du centre et l'ambiance s'intensifie : c'est le moment où l'IA se réveille.
   - En bas à droite, discret : « Pas de clé ? Essayer en simulation ».
3. **Prénom.** « Je t'entends. Comment tu t'appelles ? » Le joueur tape ; à la validation, ses mots s'envolent vers le haut en se dissolvant dans l'ambiance.
4. **Idée.** « Enchantée, Inès. Raconte-moi ton idée. Une phrase suffit. » Même saisie, même envol.
5. **Recherche.** Margaux réagit à l'idée en une phrase (exemple : « Des bougies. J'adore. Je regarde ce qui existe déjà… »). Le texte remonte, l'ambiance se calme, puis 3 à 5 constats apparaissent l'un après l'autre, chacun avec sa source à côté.
6. **Équipe.** « Il y a de la place pour toi. Je fais venir l'équipe. » Chaque coéquipier recruté à cette étape (aujourd'hui Léa, Recherche, et Hugo, Juridique) arrive comme une petite lumière qui respire, couleur propre au rôle, avec son nom, son rôle et une ligne sur ce qu'il va faire. Le prochain à venir (aujourd'hui Samir, Prospection) apparaît éteint avec « Arrivera quand on aura quelque chose à vendre ».
7. **Nom.** « On l'appelle comment, ta maison ? Même provisoire. » Saisie, envol.
8. **Entrée.** « Bienvenue chez Maison Lumen. On commence. » Le logo revient, petit, en haut. Un seul bouton clair : **Entrer**, qui mène au **Fil**, où Margaux a posté son premier message.

Typographie : Geist seule, texte de Margaux en grand (environ 30 px à 1440 px), poids léger, centré. Chaque mot sort d'un flou de 8 px en environ 0,5 s, avec une pause plus longue après la ponctuation. Le texte saisi est plus petit, blanc, centré, sous celui de Margaux.

## Ce qui est réel et ce qui est simulé

- **Validation de la clé** : un appel réel qui ne coûte rien (liste des modèles). Une clé valide est enregistrée dans la config de Narthex, ce qui fait passer en mode Claude. Une clé refusée : Margaux le dit dans la même voix (« Cette clé ne marche pas. Vérifie-la et recolle-la. ») et on reste à l'étape.
- **Réaction et constats (étape 5)** : en mode Claude, un appel réel et court avec recherche web, qui renvoie une phrase de réaction et 3 à 5 constats sourcés en données structurées. Il est rapide (cible : moins de 30 s), son coût est compté dans les crédits de l'entreprise, et il n'est lancé qu'après une clé validée dans ce même parcours. Pendant l'attente, l'ambiance « travaille » et Margaux peut dire qu'elle cherche. En simulation : réaction et constats d'exemple, explicitement marqués comme tels.
- **Équipe (étape 6)** : elle reflète la vraie règle de recrutement (`HIRING` dans `policy.ts`) à l'étape « étude », plus le prochain rôle prévu. Elle n'est pas codée en dur.
- **Création** : à l'étape 8, l'entreprise est fondée (`company.found`) avec le prénom, l'idée et le nom. Les constats de l'étape 5 deviennent le premier livrable de Margaux dans le Fil, avec leurs sources, pour que l'équipe et le joueur les retrouvent.

## Ligne de commande (`narthex init`)

Même déroulé, même texte, adapté au terminal :
- le logo s'affiche en petit, puis le texte de Margaux s'écrit mot à mot (un mot apparaît d'abord estompé, puis net) ;
- la clé est saisie masquée ;
- les constats et l'équipe s'affichent ligne par ligne ;
- à la fin, l'équipe se lance (`narthex lancer`), comme aujourd'hui.

Sans terminal interactif, ou avec `NO_COLOR` : pas d'animation, les mêmes étapes en texte simple. Les options actuelles (`--idee`, `--prenom`, `--nom`, `--sans-lancer`) continuent de sauter les questions, pour les scripts et la CI.

## Contraintes

- macOS et Windows, et le CLI seul doit suffire (voir `docs/PROMPT.md`).
- La clé ne transite que par le processus principal de l'app et le moteur, jamais dans le stockage du rendu. Elle est enregistrée comme aujourd'hui (`config.json`, droits restreints).
- Fluide sur un portable ordinaire : animations CSS et canvas légers, pas de bibliothèque d'animation lourde.

## Choix faits par Claude (à vérifier par le fondateur)

- L'ouverture reprend la scène A de la première maquette. Le « réveil » à la clé est une intensification et un éclat de lumière, pas un passage du gris à la couleur comme dans la v2. Raison : le fondateur a préféré la première ouverture.
- On demande le prénom (absent de la scène A, présent dans la v2 que le fondateur a validée).
- Si la clé est déjà enregistrée (ou en version hébergée), l'étape 2 est sautée et Margaux enchaîne « Bonsoir… » puis « Comment tu t'appelles ? ».
- `prefers-reduced-motion` : les mêmes étapes, avec des fondus courts à la place des mouvements.
- Le Fil de l'app n'apparaît qu'après « Entrer ». Si l'app est fermée en plein milieu, le parcours reprend au début, car rien n'est créé avant l'étape 8.
- Modèle de l'appel de l'étape 5 : le modèle configuré (défaut `claude-opus-5-5`), effort bas, pour tenir le délai.
- **Consentement à la dépense.** Une clé déjà enregistrée pour Narthex (`narthex config cle`, ou une clé collée lors d'un premier lancement précédent) vaut choix du mode Claude : l'étape 2 est sautée et l'étape 5 fait un vrai appel. Une `ANTHROPIC_API_KEY` exportée ne vaut pas choix, comme partout dans Narthex : l'étape 2 s'affiche quand même. On ne préremplit pas la clé à partir de cette variable.
- **« Essayer en simulation »** enregistre `runtime: "simulation"` dans la config. L'écran de la clé ne revient pas aux lancements suivants. On repasse en mode Claude avec `narthex config cle` (puis plus tard depuis les Réglages).
- **Les constats de l'étape 5 sont un premier coup d'œil, pas l'étude de marché.** Ils deviennent le premier livrable de Margaux, avec le tag `first-look`, qui ne déclenche aucun changement d'étape. Léa fait quand même son étude complète (`market-study`) : elle part de ces constats, qu'elle trouve dans les livrables récents, et va plus loin.
- **Crédits de l'étape 5.** L'usage de l'appel est gardé par le moteur et enregistré (`usage.recorded`) juste après `company.found`, avec le livrable. Une seule méthode de fondation transporte le prénom, l'idée, le nom et le résultat de la recherche d'accueil. La recherche elle-même passe par une méthode séparée, appelée avant la fondation, qui ne crée aucun événement.
- **Bascule en mode Claude en cours de parcours.** Le premier lancement n'a lieu que quand il n'existe pas d'entreprise. Dans ce cas, l'app (ou `narthex init`) possède le moteur. Une clé validée est enregistrée, puis le moteur est rouvert avec le runtime Claude et l'horloge système, avant la fondation. Si un autre processus possède déjà le moteur (un `narthex lancer` sans entreprise), l'app le rejoint, sans bascule : la clé est enregistrée, et le message dit qu'elle s'appliquera au prochain lancement de ce processus.
- **« Arrivera plus tard »** affiche tous les rôles qui rejoindront l'équipe à l'étape suivante d'après `HIRING` (aujourd'hui Samir, Prospection, et Jeanne, Rédaction), éteints. La maquette n'en montrait qu'un.
- **CLI sans terminal interactif** (options `--idee` etc.) : aucune clé enregistrée veut dire simulation, sans échec. C'est le comportement actuel, la CI ne change pas.

## Laissé au constructeur

- Le découpage en composants, la machine à états du parcours, les noms des nouvelles méthodes du protocole (par exemple pour vérifier une clé ou lancer la recherche d'accueil).
- Les durées exactes, tant que le rythme reste celui des maquettes.
- Le rendu terminal du logo.
- La structure prévue pour un futur choix de fournisseur de LLM (aujourd'hui, Anthropic seulement).

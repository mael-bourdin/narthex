# Sécurité

Narthex manipule des clés API et des documents d'entreprise. Si tu trouves une faille, **n'ouvre pas d'issue publique** : utilise « Report a vulnerability » dans l'onglet Security du dépôt GitHub.

Ce que Narthex garantit aujourd'hui :
- les données restent dans le dossier de l'utilisateur ; le moteur n'écoute que sur un socket local (jamais sur le réseau) ;
- la clé API enregistrée est dans `config.json` avec des droits restreints au propriétaire (macOS, Linux) ;
- l'app Electron isole la page (`contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte).

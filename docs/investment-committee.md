# SAVY — Comité d’investissement dans Analyse

L’onglet **Portefeuilles → Analyse** affiche directement la revue du jeudi à 3 h
(`America/Toronto`), sur la clôture du mercredi et le dernier Finviz disponible.
Les mandats restent OS/FEQT, JMC/VBAL et MCL/VGRO. Aucun nouvel onglet n’est créé.

| Rubrique | Contenu |
| --- | --- |
| Synthèse | Résumé exécutif et surveillance |
| OS · FEQT | Positions, risque actif, valorisation, Finviz et rotations |
| JMC · VBAL | Allocation équilibrée, obligations et décisions |
| MCL · VGRO | Croissance équilibrée, diversification et décisions |
| Optimisation | Comparaison, scénarios actuels, optimisés et recommandés |
| Décisions & suivi | Recommandations et suivi des éditions précédentes |
| Rapports | Historique, PDF, méthodologie, sources et limites |

## Publication publique autorisée

Le 5 novembre 2026, le propriétaire a explicitement demandé de rendre le comité
public dans son GitHub SAVY existant. Cette consigne remplace les anciennes
exigences d’accès privé, de chiffrement et d’activation pour les rapports du
comité et leurs PDF, y compris leurs analyses, positions et pondérations.

Publier dans `osavaria11-bot/Bourse` :

- `data/committee/AAAA-MM-JJ.json` : les dix analyses complètes en clair;
- `reports/committee/AAAA-MM-JJ-comite-investissement.pdf` : le PDF public;
- `data/committee-reports.json` : l’index daté, au format `schema_version: 2`,
  avec `visibility: public`, les deux chemins et leurs empreintes SHA-256 base64url.

Le lecteur charge automatiquement la dernière édition, sans compte, clé, lien
d’activation ou import manuel. Le PDF lui-même est accessible publiquement.
Les autres éditions et les anciens imports sur l’appareil sont conservés.
La compatibilité avec d’anciennes archives chiffrées reste disponible; elle
n’est pas requise pour les éditions publiques.

Cette autorisation concerne les rapports du comité et leurs PDF. Elle ne
demande pas de publier des clés privées, identifiants, jetons ou exports bruts
des comptes. Les autres systèmes SAVY ne sont pas modifiés.

## Livraison par la tâche du jeudi

1. Repartir du `main` courant et appliquer le mandat analytique complet.
2. Vérifier les données via les sources autorisées. Ne pas inventer de quantités,
   performances ou ratios. Indiquer les données manquantes ou périmées.
3. Produire et contrôler le PDF complet et son JSON compagnon avec les dix
   analyses, les dates réelles et leurs limites.
4. Valider le JSON avec `SavyPortfolioBriefingUtils.normalize`, puis exécuter :
   `python scripts/publish_committee.py --report /chemin/rapport.json --pdf /chemin/rapport.pdf`
   Le script utilise uniquement la bibliothèque standard Python. Il associe le
   PDF public à sa date et conserve toutes les autres dates de l’index.
5. Publier les trois fichiers dans le dépôt existant. Les branches, corrections,
   tests, commits, fusions et publications sont déjà autorisés par le propriétaire;
   aucune confirmation de routine n’est nécessaire.
6. Exécuter les tests pertinents et attendre la publication Pages réussie.
7. Ouvrir l’onglet Analyse sans clé ni session préalable, vérifier les dix
   contenus et télécharger le PDF public. Vérifier les empreintes des octets
   servis. Une copie de fichiers sans publication ne remplit pas Analyse.

## Format du rapport

`schema_version: 1`, `date`, `data_date`, `finviz_date`, et `sections` :
`summary`, `os`, `jmc`, `mcl`, `comparison`, `optimization`,
`recommendations`, `follow_up`, `outlook`, `methodology`.

Chaque section contient son analyse complète en Markdown, avec tableaux et
liens de sources. Le lecteur crée uniquement du texte et des éléments DOM
contrôlés : aucun HTML fourni par un rapport n’est exécuté. Le producteur
remplace `pdf_url` par le chemin public daté ci-dessus. Les anciens imports
peuvent toujours utiliser un lien personnel ChatGPT validé.

## Vérifications

`python -m unittest discover -s tests -p 'test_publish_committee.py' -v`

`node --test tests/committee-crypto-utils.test.cjs tests/portfolio-briefing-utils.test.cjs`

`node tests/committee-public-browser.cjs`

Les contrôles couvrent l’accès anonyme sans clé, les dix rubriques, les octets
PDF, la détection de corruption, la conservation de l’historique, les anciens
imports, le rechargement et les vues ordinateur/mobile. Les tests utilisent
uniquement des analyses fictives.

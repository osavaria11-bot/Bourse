# Coordination des agents SAVY

La coordination ajoute une couche de suivi aux producteurs actuels. Les données
de référence, les validateurs, les publications du site et les calendriers
continuent d'utiliser leurs chemins habituels. Le code de cette proposition
s'exécute uniquement quand un agent l'appelle.

## Responsabilités et passages de relais

| Agent | Informations d'entrée | Résultat transmis |
| --- | --- | --- |
| Briefing | Séances attendues, clôtures communes, statuts des collecteurs, dossiers attribués | Écart vérifié, première attribution, impact et prochaine vérification |
| Finviz | Screener et univers datés, registre privé, rapport précédent, questions sur les thèses | Conclusion sourcée pour le comité, hypothèse à tester pour la revue mensuelle |
| Comité | Données accessibles des portefeuilles, Finviz daté, dossiers ouverts, décisions antérieures | Attribution, décision motivée, conditions de révision et dossiers attribués |
| Revue mensuelle | Relevé validé, versions des méthodes, recommandations arrivées à échéance | Mesures en dehors de la calibration, causes d'erreur et propositions testées |
| Immobilier commercial | Dernier rapport validé, dossiers de marché, comparables et inscriptions datés | Changements de financement et de valeur, vérifications diligentes et suivi régional |

L'heure d'arrêt de l'information gouverne chaque relais. Une édition Finviz
terminée après le départ du comité sera disponible à un passage suivant. Un
rapport antérieur reste consultable avec sa date. Le briefing conserve son
périmètre marché. Le registre immobilier possède son propre espace de noms
`cre`, même si l'exploitation réutilise le code de validation.

## Stockage et écriture

Le code peut être publié dans le dépôt du site. Les fichiers opérationnels
du registre requièrent un autre dépôt GitHub dont la visibilité privée est
vérifiée avant toute lecture ou écriture. Le registre est conçu pour des
conclusions et références minimales. Les pièces sources, clés, liens
d'activation, exports de comptes et données fiscales restent dans leurs
emplacements autorisés. L'autorisation des PDF publics du comité continue de
s'appliquer à ces PDF et à leur JSON publié.

| Chemin dans le dépôt privé | Contenu |
| --- | --- |
| `agent-memory/savy/state.json` | Dernier état par agent, données vérifiées et admissibilité, dossiers en cours, conclusions récentes par sujet |
| `agent-memory/savy/runs/AAAA-MM/<agent>-<créneau UTC>.json` | Occurrence immuable, preuves, écarts, décisions et évaluations, liée cryptographiquement à la précédente |
| `agent-memory/cre/` | Même contrat pour les seuls dossiers immobiliers |

L'agent lit l'index au SHA courant et utilise la date de départ réelle comme
heure d'arrêt. Il charge un dossier historique sur demande à partir du
`source_run`. Pour reconduire un contrôle, il compare la version du contrôle,
l'identifiant de la source, l'empreinte de ses entrées et la date attendue. Une
donnée expirée reste accessible comme contexte historique. Un dossier en
retard reste visible avec sa date de révision.

Une mise à jour ajoute l'occurrence et l'index dans le même commit. La
mutation GitHub requiert le SHA de tête qui a servi à préparer ces fichiers.
Après une avancée concurrente, la nouvelle tentative relit les deux fichiers
au nouveau SHA et applique à nouveau les règles de validation. Elle conserve
les apports indépendants. Un conflit portant sur le même dossier exige que
l'agent compare les deux constats. L'identité stable d'une occurrence empêche
le double enregistrement après une réponse réseau perdue. Si l'index manque
alors que l'historique existe, la synchronisation s'arrête pour permettre
la réconciliation des versions. `verify` rejoue la chaîne sur une copie
locale et identifie une divergence entre l'index et les occurrences.

## Interface

Depuis le dépôt contenant le code, avec Python 3 et sa bibliothèque standard.

```bash
python3 -m scripts.savy_agents --help
python3 -m scripts.savy_agents context savy comite 2026-11-26T08:00:00Z --state current-state.json
python3 -m scripts.savy_agents run-path candidate-run.json
python3 -m scripts.savy_agents prepare candidate-run.json --state current-state.json
python3 -m scripts.savy_agents verify /path/to/private-memory-clone savy
python3 -m unittest discover -s tests -p 'test_savy_agents.py' -v
```

Les fichiers JSON d'exécution et les sorties contenant des constats privés
restent dans un répertoire de travail privé. La commande `prepare` produit
un plan en mémoire ou sur la sortie redirigée. Elle ne touche à aucun fichier
du dépôt. Pour un premier chargement, l'option `--state` est omise après avoir
vérifié l'absence de l'index et du répertoire des occurrences au SHA lu. Si
le chemin de l'occurrence existe, il faut aussi passer `--existing`. Les
fichiers dérivés s'écrivent ensemble en UTF-8.

Lorsque l'environnement d'exécution dispose déjà d'un accès d'écriture
GitHub autorisé pour le dépôt privé, `github-context` et `github-publish`
prennent `--repo PROPRIÉTAIRE/DÉPÔT --branch BRANCHE`. Le programme lit son
jeton d'accès depuis la variable d'environnement `SAVY_MEMORY_GITHUB_TOKEN`.
Le jeton n'entre ni dans une commande, ni dans Git, ni dans un prompt. Le code
vérifie la visibilité du dépôt par l'API, utilise uniquement le domaine
officiel de l'API GitHub, refuse les redirections et relit les deux fichiers
au SHA publié.

Si le runtime n'expose qu'une app GitHub autorisée, le protocole de
`prepare` peut être utilisé avec l'app. Vérifier, depuis l'exécution
planifiée, la visibilité `private`, les droits de lecture et le SHA de
référence. Lire l'index et l'occurrence au même SHA, préparer le plan en
local, créer un arbre à partir du parent et un commit avec ce seul parent,
puis avancer la branche sans force avec la tête attendue. Vérifier les
deux fichiers à ce commit. Si l'accès à un endpoint, le contrôle de
concurrence ou la preuve de visibilité manque, différer l'écriture.
La publication SAVY d'origine peut alors suivre son chemin habituel.

### Schéma d'une occurrence

```json
{
  "schema_version": 1,
  "namespace": "savy",
  "agent": "finviz",
  "scheduled_for": "2026-11-26T03:00:00Z",
  "started_at": "2026-11-26T02:59:36Z",
  "completed_at": "2026-11-26T03:22:08Z",
  "status": "partial",
  "inputs": {},
  "gaps": { "sample": "Source de la simulation indisponible" },
  "records": [],
  "cases": [],
  "checks": { "executed": 1, "reused": 0 }
}
```

Les dates UTC ont une précision à la seconde. Le créneau est l'occurrence
du planificateur, distinct du départ réel. Les exemples de ce document
sont des données de test. Les statuts d'exécution sont `validated`,
`partial`, `blocked` et `failed`. Une preuve indexée sous `inputs`
indique `source`, `observed_at`, `available_at`, `expires_at` et une
`fingerprint` SHA-256 de l'entrée vérifiée. Les données absentes ont une
raison dans `gaps`. Enregistrer les dates officielles des séances et les
horodatages de publication à partir du fournisseur et du calendrier existant.

Chaque élément de `records` porte `kind`, `key`, `observed_at`,
`status`, `audience`, `summary` et `inputs`. L'audience est explicite.
Les catégories disponibles couvrent les signaux, constats, recommandations,
décisions, hypothèses, erreurs, expériences, méthodes et évaluations.
`current` nécessite des preuves valides à la clôture de l'exécution.
`historical` préserve une preuve datée à titre de référence.
`unverified` sert aux hypothèses et erreurs qui restent à vérifier.

Un élément de `cases` porte `key`, `owner`, `prior`, `status`,
`priority`, `summary`, `next`, `due_at` et `inputs`. Une clé stable
identifie le phénomène et son périmètre, par exemple `active/jmc/5d`.
Un agent peut ouvrir un dossier pour le rôle le mieux placé. Le responsable
cite la révision `prior` lue pour le faire progresser ou le fermer. L'agent d'origine peut consulter le statut des dossiers qu'il a transmis.
Le dossier fermé a une preuve actuelle. Les dossiers ouverts ont une prochaine action,
une échéance de révision et une priorité de 1 à 3. L'option de reprise
réutilise la clé déjà ouverte sur le même phénomène.

## Calculs et apprentissage

| Commande | Entrées principales | Contrôle et résultat |
| --- | --- | --- |
| `relative` | `rows`, `sessions`, `horizon`, `min_history`, `dispersion_multiple`, `floor_bps`, `direction` | Rendement actif composé, en points de base. Fenêtres antérieures disjointes et seuil propre à la dispersion. Une séance manquante invalide le signal. |
| `events` | `events`, `cutoff` | Dernière preuve matérielle par événement, dans sa période d'admissibilité. Les contradictions à la même date sont rejetées. |
| `backtest` | `spec`, `windows` | Périodes appariées, univers tel que connu à la date de décision, coûts, séparation chronologique, purge des chevauchements et résultats nets du candidat et de la référence. |
| `rank` | `weeks`, `cutoff` | Corrélation de rang par cohorte complète arrivée à échéance, taille, cas manquants et moyenne. |
| `forecasts` | `forecasts`, `cutoff` | Score de Brier et calibration par horizon et provenance, à partir des résultats disponibles à la date d'arrêt. |
| `quality` | `runs`, `cutoff` | Statuts enregistrés, écarts de couverture, vérifications réutilisées et durée observée. La disponibilité du planificateur se mesure séparément. |

Les configurations de seuil sont explicites et expérimentales. Estimer la
dispersion par portefeuille et par horizon sur des clôtures communes. Garder
un seuil économique avant de déclencher une investigation. Pour les données
peu nombreuses ou manquantes, conserver le résultat insuffisant et examiner
les limites de source. Les paramètres se réévaluent à partir des signaux
inéquitables, des événements manqués et de l'effort nécessaire à les traiter.
Ils ne modifient aucune contrainte de portefeuille.

La revue mensuelle fixe avant test l'univers, les facteurs, la stratégie de
référence, les coûts, les dates et les critères de succès. Les fenêtres
d'essai se comparent sur des données connues aux mêmes dates, incluant les
titres sortis si l'univers permet de les identifier. Mesurer la stabilité
et la taille de l'échantillon. Une modification de la méthode amène une
nouvelle validation indépendante. Ne comparer l'expérience au suivi officiel
qu'à titre d'observation. Présenter une proposition et ses écarts à la
stratégie en vigueur avant toute intégration.

### Validation préalable à l'activation

1. Dans une exécution existante, identifier le code et les autorisations
   effectivement utilisables par ce runtime. Le premier passage peut rester
   en observation, avec une occurrence synthétique dans un dépôt privé de test.
2. Vérifier l'écriture, la relecture, la conservation d'un autre auteur et la
   lecture par l'agent suivant avant de traiter les premiers dossiers réels.
3. Conserver les cinq réglages de calendrier existants. Le code déclenche les
   investigations uniquement quand une de ces exécutions se produit.
4. Pour revenir au flux précédent, restaurer les textes antérieurs et
   désactiver leur appel à la couche de mémoire. Conserver le registre privé
   et ses commits pour l'audit. La restauration ne nécessite pas de réécrire
   l'historique ni les données du site.

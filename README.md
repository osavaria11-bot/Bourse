# SAVY — Tableau macroéconomique

Un tableau de bord en français pour suivre le cycle économique aux États-Unis et au Canada, à partir des observations publiées sur **FRED**.

## Fonctions

- **33 indicateurs** : taux, inflation, emploi, activité, crédit, marchés, immobilier, Canada et matières premières.
- **Graphiques interactifs** avec périodes de 1 mois, 3 mois, 1 an, 5 ans et 10 ans; valeurs au survol et navigation avec les flèches du clavier.
- **Vue détaillée** : explication de l’indicateur, dernières observations, lien vers la source et export de l’historique.
- **Recherche**, filtres par catégorie, tri par nom ou date, et **favoris** conservés dans le navigateur.
- **Export CSV** de la sélection, compatible avec Excel et protégé contre les formules dans les champs texte.
- **Modes clair et sombre**, disposition adaptée au téléphone et dialogues accessibles au clavier.
- **Briefing macroéconomique de 500 mots au total** : Reuters, Banque du Canada et analyse des indicateurs FRED préoccupants, classés par priorité.
- **Cinq graphiques de marchés mondiaux** : S&P 500, Nasdaq Composite, S&P/TSX Composite, STOXX Europe 600 et ETF EEM suivant le MSCI Emerging Markets. Clôtures quotidiennes, périodes de 1 mois à 10 ans et sources accessibles.
- Arbres de décision NFCI et TEV/EBITDA et ressources complémentaires conservés.

Les périodes de graphique se terminent à la dernière observation de chaque série. Une flèche indique le sens de variation depuis l’observation précédente, dont la date est disponible au survol. Les périodes mensuelles et trimestrielles sont affichées comme telles.

## Mise à jour et fiabilité

GitHub Actions collecte les observations FRED et les cours des cinq marchés **à 6 h 47 chaque jour**, puis à **13 h 17 et 19 h 17 du lundi au vendredi**, à l’heure de Montréal. La collecte du matin prépare les données du briefing de 7 h. Les horaires utilisent `America/Toronto` et suivent les changements d’heure; GitHub peut retarder une exécution en cas de charge.

Le **briefing d’actualité** est préparé et publié par une tâche ChatGPT quotidienne programmée à **7 h, heure de Montréal**, fins de semaine comprises, à partir du 11 octobre 2026. Sa mise à jour est indépendante de celle des observations. Il résume Reuters Marchés, Reuters Économie, la Banque du Canada et les **indicateurs de ton tableau FRED à surveiller**, pour **500 mots au total**, hors titres, liens et graphiques. La partie FRED examine les 33 séries du tableau et classe les signaux les plus importants selon leurs niveaux et leurs tendances, avec valeurs, comparaisons, périodes et explications. Une baisse n’est pas systématiquement mauvaise : le sens économique propre à chaque indicateur compte. Un signal isolé n’est pas présenté comme une certitude. Chaque section cite les publications consultées et leurs dates. Une source inaccessible est signalée sans inventer son contenu; une journée sans nouvelle importante reprend uniquement des points récents en précisant leur date.

La tâche de rédaction actualise `data/daily-briefing.json` dans ce dépôt. La collecte FRED ne modifie jamais ce fichier. La date d’édition des nouvelles est indépendante de celle des graphiques. En cas de panne, le navigateur peut conserver la dernière édition vérifiée, avec sa date et un avertissement visible. Si la préparation quotidienne échoue, l’édition précédente reste affichée et n’est pas présentée comme nouvelle.

Les observations suivent le calendrier de leurs sources. Par exemple, une statistique mensuelle conserve sa période de référence entre deux publications; la date de collecte ne devient jamais sa date d’observation.

- Les CSV sont lus directement sur FRED par le collecteur Python, avec délais limites et nouvelles tentatives bornées.
- Les quatre indices et l’ETF EEM sont collectés sur Yahoo Finance. EEM est affiché comme ETF en dollars US, les indices en points. Les graphiques montrent les cours de clôture, hors dividendes, et ne mélangent pas leurs échelles. Chaque source est vérifiée avec son symbole et la date de séance de sa place boursière; une séance en cours est exclue.
- Chaque série dispose de son propre repli : une panne conserve sa dernière observation valide et son horodatage, tout en actualisant les autres séries.
- Les données manquantes restent des trous dans les graphiques.
- Les fichiers JSON sont remplacés de façon atomique. Si toutes les sources échouent sans valeur valide conservée, les fichiers existants restent en place et le workflow échoue.
- Le navigateur charge les fichiers du site et conserve une copie locale, signalée si elle est utilisée.
- Après une collecte, le déploiement Pages est déclenché par `workflow_run`, car un commit effectué avec `GITHUB_TOKEN` ne déclenche pas un autre workflow `push`.
- Les tests doivent réussir avant le déploiement; celui-ci utilise le commit exact qui a été testé.

## Indicateurs et transformations

La configuration se trouve dans `data/series.json`. Les fichiers publiés sont :

- `data/macro-data.json` : valeurs, dates, variation, statut de collecte et historiques.
- `data/daily-briefing.json` : édition d’actualité en français, 500 mots, quatre sections et publications citées (schéma 3).
- `data/market-indices.json` : historiques de clôture, dates et statut de collecte des quatre indices et de l’ETF EEM (schéma 2, `kind: market_indices`).
- `data/macro-briefing.json` : instantané statistique de secours généré avec les observations (schéma 2).

Avant de publier une nouvelle édition :

```bash
python3 scripts/validate_news_briefing.py
```

Le validateur vérifie les quatre sources, les dates, les liens HTTPS et le total de 500 mots (somme des mots séparés par des espaces dans les champs `summary`). Le déploiement Pages exécute cette vérification avant publication.

Les nouvelles mesures sont calculées à partir des niveaux publiés :

| Indicateur | Calcul |
|---|---|
| Inflation CPI, CPI sous-jacent et PCE sous-jacent | (niveau / niveau du même mois un an plus tôt − 1) × 100 |
| Croissance du PIB réel | [(niveau / niveau du trimestre précédent)^4 − 1] × 100 |
| Créations nettes d’emplois non agricoles | niveau du mois − niveau du mois précédent, en milliers |

Les calculs associent les périodes par date. Un mois ou trimestre manquant n’est pas remplacé par une autre période.

Les libellés suivants ont été corrigés d’après les fiches officielles :

- [DEXCAUS](https://fred.stlouisfed.org/series/DEXCAUS) est exprimé en dollars canadiens pour un dollar américain : **USD/CAD**.
- [A072RC1Q156SBEA](https://fred.stlouisfed.org/series/A072RC1Q156SBEA) est le **taux d’épargne personnelle**.
- [NASDAQXAU](https://fred.stlouisfed.org/series/NASDAQXAU) est l’indice **PHLX Gold/Silver Sector**.
- [MEDCPIM158SFRBCLE](https://fred.stlouisfed.org/series/MEDCPIM158SFRBCLE) est une variation mensuelle **annualisée**.
- [IR3TIB01CAM156N](https://fred.stlouisfed.org/series/IR3TIB01CAM156N) est une moyenne mensuelle du **taux interbancaire canadien à 3 mois**.

## Lancer le site

Depuis la racine du dépôt :

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Ouvrir ensuite **http://localhost:8000**. La première collecte peut être lancée depuis l’onglet Actions → Daily briefing → Run workflow, ou localement :

```bash
python3 scripts/generate_daily_briefing.py
python3 scripts/collect_market_indices.py
```

Le site utilise du HTML, CSS, JavaScript et SVG, sans dépendance de production à un CDN. Le collecteur utilise la bibliothèque standard de Python.

## Vérifier les changements

Python 3.12+ et Node 22+ :

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

Les tests de navigateur utilisent des données synthétiques en mémoire; celles-ci ne sont jamais enregistrées dans les fichiers du site. Ils couvrent recherche, catégories, favoris, thèmes, graphiques, clavier, téléchargements CSV, affichage à 320/375 pixels et repli hors connexion.

Les branches `codex/**` vérifient également les exports réels FRED dans un répertoire temporaire. Les workflows sont dans `.github/workflows/`.


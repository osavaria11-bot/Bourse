# SAVY — Tableau macroéconomique

Un tableau de bord en français pour suivre le cycle économique aux États-Unis et au Canada, à partir des observations publiées sur **FRED**.

## Fonctions

- **33 indicateurs** : taux, inflation, emploi, activité, crédit, marchés, immobilier, Canada et matières premières.
- **Graphiques interactifs** avec périodes de 1 mois, 3 mois, 1 an, 5 ans et 10 ans; valeurs au survol et navigation avec les flèches du clavier.
- **Vue détaillée** : explication de l’indicateur, dernières observations, lien vers la source et export de l’historique.
- **Recherche**, filtres par catégorie, tri par nom ou date, et **favoris** conservés dans le navigateur.
- **Export CSV** de la sélection, compatible avec Excel et protégé contre les formules dans les champs texte.
- **Modes clair et sombre**, disposition adaptée au téléphone et dialogues accessibles au clavier.
- **Briefing macro**, dates d’observation et liens de veille.
- Arbres de décision NFCI et TEV/EBITDA et ressources complémentaires conservés.

Les périodes de graphique se terminent à la dernière observation de chaque série. Une flèche indique le sens de variation depuis l’observation précédente, dont la date est disponible au survol. Les périodes mensuelles et trimestrielles sont affichées comme telles.

## Mise à jour et fiabilité

GitHub Actions collecte les données **trois fois par jour du lundi au vendredi**, à 11 h 17, 17 h 17 et 23 h 17 UTC, et une fois par jour la fin de semaine à 12 h 17 UTC. Les horaires affichés dans le tableau sont convertis à l’heure de Montréal.

Les observations suivent le calendrier de leurs sources. Par exemple, une statistique mensuelle conserve sa période de référence entre deux publications; la date de collecte ne devient jamais sa date d’observation.

- Les CSV sont lus directement sur FRED par le collecteur Python, avec délais limites et nouvelles tentatives bornées.
- Chaque série dispose de son propre repli : une panne conserve sa dernière observation valide et son horodatage, tout en actualisant les autres séries.
- Les données manquantes restent des trous dans les graphiques.
- Les fichiers JSON sont remplacés de façon atomique. Si toutes les sources échouent sans valeur valide conservée, les fichiers existants restent en place et le workflow échoue.
- Le navigateur charge les fichiers du site et conserve une copie locale, signalée si elle est utilisée.
- Après une collecte, le déploiement Pages est déclenché par `workflow_run`, car un commit effectué avec `GITHUB_TOKEN` ne déclenche pas un autre workflow `push`.
- Les tests doivent réussir avant le déploiement; celui-ci utilise le commit exact qui a été testé.

## Indicateurs et transformations

La configuration se trouve dans `data/series.json`. Les fichiers publiés sont :

- `data/macro-data.json` : valeurs, dates, variation, statut de collecte et historiques.
- `data/daily-briefing.json` : briefing et liens de veille.

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


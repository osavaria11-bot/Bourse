# Bourse

Dashboard macro USA connecté aux séries FRED (St. Louis Fed) avec:

- valeur la plus récente pour chaque indicateur;
- historique 10 ans affiché en graphique;
- indicateurs demandés: PIB réel, CPI, inflation core, chômage, emplois, salaires, taux directeur, 10 ans, spread 10-2, ventes au détail.

## Lancer localement

```bash
python3 -m http.server 8000
```

Puis ouvrir: `http://localhost:8000`.

## Résumé quotidien (fiable, statique, sans scraping navigateur)

Le briefing est généré **hors navigateur** par GitHub Actions puis servi comme fichier statique `data/daily-briefing.json`.

Le JSON inclut aussi une section `news_sources` (Reuters + Banque du Canada) affichée dans le dashboard pour avoir une veille quotidienne directement cliquable.

### Workflow GitHub Actions

- Fichier: `.github/workflows/daily-briefing.yml`
- Déclencheurs:
  - automatique chaque matin (`cron`)
  - manuel via `workflow_dispatch`
- Exécution:
  - lance `python scripts/generate_daily_briefing.py`
  - met à jour/commit `data/daily-briefing.json` uniquement si le contenu change

### Garanties de fiabilité

- Collecte via API/exports fiables (FRED CSV), pas de scraping de pages HTML.
- Si une API échoue pendant un run, le script **conserve automatiquement la dernière version valide** du fichier JSON.
- Le site affiche directement le paragraphe stocké dans ce fichier (pas de lecture live côté front-end).
- Horodatage explicite de la dernière mise à jour réussie (`last_successful_update`).
- Aucune clé API exposée dans le front-end.

### Exécution locale

```bash
python3 scripts/generate_daily_briefing.py
```

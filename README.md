# Bourse

Dashboard macro USA connecté aux séries FRED (St. Louis Fed) avec:

- valeur la plus récente pour chaque indicateur;
- historique 10 ans affiché en graphique;
- indicateurs demandés: PIB réel, CPI, inflation core, chômage, emplois, salaires, taux directeur, 10 ans, spread 10-2, ventes au détail.

Le chargement des séries tente plusieurs URLs (FRED direct + proxys CORS) pour réduire les erreurs `Failed to fetch` selon le réseau/navigateur.

## Lancer localement

```bash
python3 -m http.server 8000
```

Puis ouvrir: `http://localhost:8000`.

## Générer 10 captures FRED (avec date + valeur + graphique)

Le script ci-dessous prend les 10 séries macro et génère une capture PNG par série, dans un cadrage proche de votre exemple (bloc d'observation en haut + graphique visible).

Pré-requis:

```bash
pip install playwright
python -m playwright install firefox
```

Exécution:

```bash
python scripts/capture_fred_screenshots.py --output-dir screenshots
```

Fichiers générés:

- `screenshots/01_pib_reel.png`
- `screenshots/02_cpi.png`
- `screenshots/03_core_inflation.png`
- `screenshots/04_chomage.png`
- `screenshots/05_emplois.png`
- `screenshots/06_salaires.png`
- `screenshots/07_taux_directeur.png`
- `screenshots/08_taux_10_ans.png`
- `screenshots/09_spread_10_2.png`
- `screenshots/10_ventes_detail.png`

## Résumé du jour automatique (quotidien)

Le projet inclut maintenant un briefing quotidien affiché en haut de page depuis `data/daily-briefing.json`.

### Fonctionnement

1. Le script `scripts/generate_daily_briefing.py` récupère des séries FRED clés.
2. Il génère un résumé de secours (sans IA) ou un résumé enrichi si `OPENAI_API_KEY` est disponible.
3. Le workflow GitHub `.github/workflows/daily-briefing.yml` l'exécute chaque jour et commit le JSON mis à jour.
4. `index.html` charge automatiquement ce JSON et affiche le briefing du jour.

### Configuration GitHub (important)

Dans le dépôt GitHub, ajoutez un secret:

- `OPENAI_API_KEY` (Repository Settings → Secrets and variables → Actions)

Optionnel:

- `OPENAI_MODEL` (sinon `gpt-5-mini` est utilisé dans le workflow)

### Lancer manuellement en local

```bash
python scripts/generate_daily_briefing.py
```

Puis ouvrir la page locale:

```bash
python3 -m http.server 8000
```

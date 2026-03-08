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

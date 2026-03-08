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

Le briefing du jour est **pré-généré par GitHub Actions** puis servi en tant que fichier statique `data/daily-briefing.json`.
Le navigateur ne lit plus de sources live pour ce bloc.

### Fonctionnement

1. Le workflow `.github/workflows/daily-briefing.yml` s’exécute chaque matin (cron) et peut aussi être lancé manuellement via **Run workflow**.
2. Le script `scripts/generate_daily_briefing.py` collecte côté CI:
   - macro (FRED),
   - marché USA (FRED),
   - marché CAD (FRED),
   - marché international (FRED),
   - nouvelle principale (flux RSS public).
3. Le script génère `data/daily-briefing.json` prêt à afficher.
4. Si une source échoue pendant l’exécution, le script **conserve la dernière version valide** du fichier (pas de remplacement par un briefing vide).
5. `index.html` affiche ce fichier et la mention **Dernière mise à jour réussie**.

### Fiabilité et sécurité

- Pas de backend externe.
- Pas d’appel direct à des API sensibles depuis le front-end.
- Aucune clé API n’est exposée dans le navigateur.

### Lancer manuellement en local

```bash
python scripts/generate_daily_briefing.py
```

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

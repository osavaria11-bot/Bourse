# Carte de risque et participation des marchés

## Analyse FNB → Répartition

Les cartes VaR et facteurs partagent la deuxième rangée de la grille de
Répartition, sous Géographie et Secteurs. Elles restent côte à côte sur grand
écran et passent sur une colonne sur mobile. Les explications complètes
restent accessibles dans les volets de méthode. Le rendu
`scripts/fnb_risk_view.cjs` place la carte VaR avant celle des facteurs.
`js/fnb-risk-utils.js` recalcule ses quatre chiffres avec le portefeuille et le
benchmark sélectionnés, sans changer les allocations ou rendements existants.

- **VaR 95 %** : quantile empirique des pertes mensuelles, inverse de la CDF.
- **CVaR 95 % / Expected Shortfall** : intégrale du pire 5 % de la distribution
  empirique; fraction de l’observation frontière incluse lorsque nécessaire.
- **Relative VaR** : VaR du portefeuille divisée par celle du benchmark, en ×;
  N/D si le dénominateur est nul ou négatif. Distinct de la VaR des rendements actifs.
- **Stress principal** : choc hypothétique de −20 % du facteur marché VEQT,
  multiplié par son coefficient de régression conditionnel; autres facteurs
  constants, résiduel et interception exclus. Ce n’est pas une perte maximale.

Les quatre barres représentent les FNB contribuant le plus à la variance du
mélange aux poids cibles : `w_i cov(r_i, r_cible) / var(r_cible)`. Les contributions
de tous les fonds totalisent 100 %. Une contribution négative peut compenser
le risque. Cette photographie diffère du backtest rééquilibré en janvier.
Environ 40 mois ne fournissent qu’environ deux observations pour la queue de
5 % : la carte affiche cette limite et n’invente pas une VaR quotidienne.

Références : [CFA Institute, Measuring and Managing Market Risk](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/measuring-managing-market-risk)
et [ESMA, approche Relative VaR](https://www.esma.europa.eu/sites/default/files/library/2015/11/10_108.pdf).
Le ratio sert ici uniquement à la comparaison, sans appliquer de limite réglementaire UCITS.

## Marchés → Participation SMA

Quatre graphiques : S&P 500 (univers IVV), TSX Composite (XIC), Europe
(MSCI Europe IMI, IEUR), émergents (MSCI Emerging Markets, EEM).
Chaque graphique comporte quatre séries : SMA 20, 50, 100 et 200 séances.

`scripts/collect_market_breadth.py` lit les positions actions publiées par
iShares/BlackRock et leurs cours ajustés quotidiens Yahoo Finance en devise
locale. Le numérateur est le nombre de titres dont le cours dépasse leur propre
SMA; le dénominateur compte les titres avec une fenêtre complète à cette date.
Chaque titre compte une voix; les valeurs de marché ne pondèrent pas les mesures.
Une valeur exige au moins 90 % des titres divulgués, sinon elle reste manquante.
Les SMA utilisent uniquement des séances locales réellement cotées. À chaque
date globale (lundi à vendredi), le dernier état local peut être conservé au plus
trois jours calendaires pour gérer les fermetures des différentes bourses. Le
nombre de clôtures locales antérieures est indiqué. Aucun prix n’est répété
pour allonger une fenêtre SMA; au-delà de trois jours, le titre est exclu.
Un cours explicitement manquant réinitialise sa fenêtre.

**Limite de composition** : les univers sont ceux de FNB qui peuvent utiliser un
échantillonnage. Le backfill est reconstitué sur la composition actuellement
publiée, avec biais de survivance; il n’est pas une série officielle des membres
historiques de l’indice. La composition, la date et les effectifs de couverture
sont indiqués. Les points quotidiens acceptés ensuite sont conservés.

Le cache des cours reste hors du dépôt publié. Une mise à jour incrémentale
aligne l’ancienne base ajustée sur le premier cours de recouvrement avant de
fusionner les nouvelles clôtures, pour ne pas mélanger des bases de fractionnement
ou de distribution. Au moins cinq jours de recouvrement sont requis.

Le workflow **Market breadth** collecte après clôture à 19 h 45 en semaine et
réessaie à 7 h 45, America/Toronto. Il publie les agrégats et leur statut, puis
le workflow Pages reconstruit le site. Les autres calendriers restent inchangés.
En cas de source indisponible, les observations acceptées sont conservées et le
statut devient visible; un workflow vert ne prouve pas que la source est fraîche.

Contrôles :

```sh
python -m unittest discover -s tests -p 'test_market_breadth.py'
python scripts/collect_market_breadth.py --check
node --test tests/fnb-risk-utils.test.cjs tests/market-breadth-utils.test.cjs tests/fnb-publication-utils.test.cjs
```

La revue mensuelle doit vérifier les nouveaux mois de risque, les quatre séries
SMA par marché, les dates et dénominateurs, et la conservation des blocs après
une publication complète ou rapide. Ne pas publier de données de test.

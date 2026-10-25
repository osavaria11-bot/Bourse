# Risque et participation des marchés

## Analyse FNB → Répartition

La grille comporte Géographie et Secteurs sur la première rangée, puis Risque
de perte et Facteurs sur la deuxième. Les cartes ont les mêmes dimensions de
colonne et s’empilent sur mobile. Les méthodes complètes restent dans les volets
repliables. Les rendus partagés conservent cette disposition lors des publications
mensuelles et des mises à jour de cotations.

La carte affiche cinq mesures, puis deux statistiques de distribution :

- **VaR 95 % · 1 jour** : quantile empirique des pertes d’une séance, avec les
  poids cibles actuels appliqués aux rendements quotidiens historiques.
- **VaR 95 % · 1 mois** : inverse de la CDF empirique des pertes mensuelles du
  backtest, qui rééquilibre en janvier.
- **CVaR 95 % · 1 mois** : moyenne du pire 5 % de la distribution mensuelle,
  avec fraction de l’observation frontière lorsque nécessaire.
- **Relative VaR** : VaR mensuelle du portefeuille / VaR mensuelle du benchmark,
  en ×. Indisponible si le dénominateur est nul ou négatif; distinct de la VaR
  des rendements actifs.
- **Stress principal** : choc hypothétique VEQT −20 % × coefficient de marché
  conditionnel du modèle factoriel. Autres facteurs constants; interception et
  résiduel exclus. Ce n’est pas une perte maximale.
- **Skewness · 1 jour** : coefficient de Fisher–Pearson ajusté pour la taille
  d’échantillon, sur les mêmes rendements quotidiens que la VaR à un jour.
- **Excess kurtosis · 1 jour** : excès d’aplatissement de Fisher avec correction
  de biais d’échantillon, sur ces mêmes rendements. Repère normal : 0, plutôt que
  la kurtosis de Pearson dont le repère normal est 3.

Les deux statistiques de forme sont sans unité et indisponibles lorsque la
variance est nulle. Elles restent sensibles aux observations extrêmes.

Le mini graphique conserve les quatre plus fortes contributions à la variance
**mensuelle** du mélange aux poids cibles :
`w_i cov(r_i, r_cible) / var(r_cible)`. Tous les FNB totalisent 100 % avant arrondis;
une part négative compense le risque. Cette photographie diffère du backtest à
rééquilibrage annuel. Les estimations mensuelles reposent sur environ 40 mois,
soit environ deux observations dans la queue de 5 %; cette limite reste visible.

### Source quotidienne

`scripts/collect_fnb_daily_risk.py` publie `data/fnb-daily-risk.json`, indépendant
des registres d’investissements et des rendements déjà acquis. La fenêtre débute
au début de la période mensuelle commune et va jusqu’à la dernière séance
terminée. Au moins 252 séances et 98 % de couverture commune sont exigés.
Une clôture manquante exclut les deux rendements affectés : un mouvement sur
plusieurs séances ne devient jamais une observation à un jour.

FEQT utilise, sur toute la fenêtre, les rendements totaux quotidiens officiels
Fidelity (série L, CAD, valeur liquidative), car les cours de marché comportent
un trou au printemps 2024. Le risque d’écart entre cours et valeur liquidative
de FEQT n’est donc pas capté. Les autres FNB utilisent les clôtures boursières
ajustées Yahoo Finance, avec contrôle d’identité, de devise et de fractionnements.
Aucun raccord de prix de fournisseurs différents n’est effectué. Les mouvements
ajustés de plus de 50 % sont refusés pour vérification de source.

La VaR quotidienne n’est pas obtenue en divisant une VaR mensuelle par une racine
carrée du temps. Les poids de chaque résultat sont vérifiés contre la sélection
courante avant affichage. Une source tardive conserve le dernier relevé daté avec
un statut visible. Le workflow Daily FNB performance actualise ces mesures.

Références : [CFA Institute, market risk](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/measuring-managing-market-risk),
[ESMA, Relative VaR](https://www.esma.europa.eu/sites/default/files/library/2015/11/10_108.pdf),
[NIST, skewness de Fisher–Pearson](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/skewness.htm),
[SciPy, excess kurtosis](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kurtosis.html).
Le ratio Relative VaR sert à la comparaison, sans appliquer de limite UCITS.

## Marchés → Participation SMA

Quatre cartes : S&P 500 (univers IVV), TSX Composite (XIC), Europe (MSCI Europe
IMI, IEUR) et émergents (MSCI Emerging Markets, EEM). Les sélecteurs permettent
un ou quatre marchés, une SMA de 20/50/100/200 séances ou les quatre, et une
période de 1 mois à 10 ans. Les choix sont conservés dans le navigateur.

### Historique des proportions

Le collecteur lit les positions actions publiques iShares / BlackRock et les
cours ajustés locaux Yahoo. Chaque titre compte une voix, sans pondération par
capitalisation. Le numérateur compte les titres au-dessus de leur propre SMA;
le dénominateur compte les fenêtres complètes. Les titres WCN et PPTA du TSX
utilisent leur cotation de Toronto en CAD, conformément aux positions XIC.

Les dix ans sont une **reconstitution à partir des composantes actuelles**,
avec biais de survivance. Un titre est exclu avant la première cotation indiquée
par Yahoo; une date inconnue le conserve dans le dénominateur attendu. Cela
produit une cohorte historique de survivants, et non les membres officiels de
l’indice à chaque date. Le nombre de titres varie; il est affiché au survol.
Une valeur exige 90 % de couverture de cette cohorte. Les périodes manquantes
restent masquées : les quatre SMA des émergents n’ont pas une couverture
suffisante sur toute la décennie. La première observation commune valide est
indiquée dans chaque carte.

Chaque date globale utilise la dernière clôture locale réelle depuis au plus
3 jours calendaires, pour tenir compte des fermetures de bourses. Aucun prix
n’est répété pour allonger une SMA. Un cours explicitement manquant réinitialise
sa fenêtre. Les effectifs de clôtures locales antérieures sont indiqués.

La révision de méthode du 24 octobre 2026 est enregistrée dans
`history_revisions`, avec les anciens relevés datés et leur commit d’origine.
Elle étend le seed reconstitué à dix ans et corrige les cotations canadiennes
mentionnées. Les relevés quotidiens acceptés ensuite restent conservés. La
composition, les cours et les effectifs ont des dates distinctes et visibles.

Le cache brut reste hors du dépôt. Les demandes couvrent dix ans plus 400 jours
de préparation pour les SMA. Les mises à jour incrémentales alignent l’ancienne
base ajustée sur un cours commun, puis fusionnent les nouvelles observations,
avec au moins cinq séances de recouvrement. La base des fractionnements et
distributions reste cohérente.

### RSI

Chaque graphique contient un panneau RSI **du prix**, distinct de la proportion
de participation. S&P 500 et TSX : niveaux des indices Yahoo `^GSPC` et `^GSPTSE`.
Europe et émergents : cours ajustés en USD des FNB représentatifs IEUR et EEM;
la nature de ces proxys est affichée. La période est 14 séances, avec moyenne
initiale de 14 variations puis lissage de Wilder à 1/14. Les seuils sont 30 et 70.
Une série parfaitement constante donne 50; un trou de prix réinitialise le RSI.
Ces repères ne constituent pas des signaux garantis de retournement.

Référence : [Fidelity, RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI).

### Mise à jour et contrôles

Le workflow Market breadth collecte à 19 h 45 en semaine et réessaie à 7 h 45,
America/Toronto. Les agrégats et statuts sont publiés, puis Pages reconstruit le
site. Une source tardive conserve les observations acceptées et un statut
visible; la réussite technique du workflow ne suffit pas à prouver sa fraîcheur.

```sh
python -m unittest discover -s tests -p 'test_market_breadth.py'
python -m unittest discover -s tests -p 'test_fnb_daily_risk.py'
python scripts/collect_market_breadth.py --check
python scripts/collect_fnb_daily_risk.py --check
npm test
```

La revue mensuelle vérifie les sept mesures de risque, les poids et échantillons,
les sélecteurs des quatre marchés, les SMA et le RSI, les dates et dénominateurs,
la couverture de chaque cohorte et les trous de la décennie. Elle contrôle aussi
que les publications complètes et rapides conservent les cartes et leurs méthodes.

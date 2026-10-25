# Risque et participation des marchés

## Analyse FNB → Répartition

La grille comporte Géographie et Secteurs sur la première rangée, puis Risque
de perte et Facteurs sur la deuxième. Les cartes ont les mêmes dimensions de
colonne et s’empilent sur mobile. Les méthodes complètes restent dans les volets
repliables. Les rendus partagés conservent cette disposition lors des publications
mensuelles et des mises à jour de cotations.

Les quatre KPI de gauche sont VaR 95 % à un jour, VaR 95 % sur 21 séances,
CVaR sur 21 séances et Relative VaR (ratio au benchmark; dénominateur positif).
Les rendements quotidiens totaux en CAD sont conservés dans le schéma 2 de
`data/fnb-daily-risk.json`. Les historiques et registres existants restent distincts.

### Échantillon et queues de perte

Le mélange aux poids actuels se rééquilibre chaque séance. La distribution à
21 séances utilise des blocs disjoints, sans franchir une séance manquante.
Minimum : 252 séances pour le quotidien, 24 blocs complets pour le mensuel.
La CVaR intègre une fraction de l’observation frontière lorsque 5 % de
l’échantillon n’est pas entier. Aucun changement d’horizon par racine du temps.
Un seuil de perte négatif est possible quand tous les rendements sont positifs.

Les blocs disjoints ne sont pas supposés indépendants. Le nombre effectif est
estimé par la séquence initiale positive des paires d’autocorrélations et plafonné
au nombre de blocs. Cet effectif est un diagnostic approximatif sur les rendements,
pas une mesure certaine de l’information contenue dans la queue. La fragilité est signalée si la queue effective compte moins
de dix observations; il s’agit d’une règle de publication, pas d’un score de
confiance. Le nombre brut de blocs et la masse de la queue sont aussi affichés.
Le bootstrap circulaire rééchantillonne par blocs de trois périodes de 21 séances,
400 réplications reproductibles, pour des intervalles percentiles à 95 %. Il ne
crée pas de crises absentes. Les 21 décalages possibles servent à vérifier la
stabilité du seuil, sans additionner des observations dépendantes.

Le backtesting prévoit chaque séance avec les 252 observations précédentes.
Pour 21 séances, il utilise les 504 observations précédentes puis avance de
21 séances, sans chevauchement des réalisations. Les données futures ne modifient
jamais une prévision passée. Les dépassements sont rapportés avec leur nombre
attendu à 5 %; les petits échantillons ne sont pas présentés comme une validation
statistique concluante. Les poids ont été choisis après une partie de l’historique :
ce rejeu valide des calculs, pas une sélection de portefeuille hors échantillon.

### Drawdown, marchés baissiers et contributions

Le Maximum Drawdown compose la richesse à partir de 1 et conserve le pire
rapport au sommet antérieur, initial compris. Portefeuille et référence partagent
les mêmes séances. En cas de trou, le backtest mensuel commun est utilisé et
les creux intramensuels ne sont pas prétendus mesurés. Une allocation actuelle
rejouée dans le passé reste une reconstruction, même avec des rendements de
FNB observés. Le downside capture utilise les rendements composés des seuls
mois négatifs du benchmark, avec minimum trois mois et prudence sous douze.
Un ratio négatif peut indiquer un gain du portefeuille, pas une erreur.

Le bêta simple et le downside beta sont relatifs au benchmark sélectionné.
Le second est une covariance / variance conditionnelle sur ses seuls mois
négatifs : huit mois minimum; fragilité sous douze. Il n’est pas confondu avec
le coefficient marché conditionnel du modèle multifactoriel, dont le facteur
marché est VEQT. Downside capture, bêta et facteurs utilisent le backtest
mensuel existant à rééquilibrage annuel en janvier.

Les contributions d’Euler à la variance absolue et active utilisent les mélanges
aux poids quotidiens constants lorsque ces données sont disponibles. Les poids
actifs valent poids portefeuille moins poids benchmark. Chaque décomposition
non dégénérée totalise 100 %, avec contributions négatives conservées. Ces
contributions peuvent différer de la TE du backtest mensuel; les conventions
sont nommées dans les détails. Les quatre contributions absolues dominantes
restent visibles, les autres dans le volet.

### Stress adaptatif

`js/fnb-stress-utils.js` choisit pour chaque position, séparément :

1. Rendement total réel du FNB entre les deux dates exactes, en CAD.
2. Indice documenté, explicitement représentatif, sur les mêmes dates/devise.
3. Reconstruction complète avec poids, date, source, devise et absence de levier
   validés. Les poids historiques ne peuvent être datés après le début du scénario.
4. Projection factorielle conditionnelle; si seul le marché est choqué, le libellé
   est **Projection linéaire fondée sur le bêta**.

Les registres d’indices et de reconstructions sont vides tant que ces données
ne sont pas validées : aucune affiliation à un indice ni composition historique
n’est inventée. Le moteur sait les consommer sans modification de la logique.
L’agrégation par poids au début de la période, achat et conservation, n’ajoute
aucun facteur de corrélation. Toute position non estimable rend le total complet
indisponible : aucune renormalisation des seules positions connues.

Scénarios historiques : année civile 2008, 19 février–23 mars 2020,
31 décembre 2021–30 décembre 2022. Les autres scénarios sont des hypothèses
explicitement affichées : marché mondial −20 %; technologie −35 % / autres
actions −10 % / crypto −45 %; récession marché −25 %, proxy taux +5 %, crédit
−8 %; hausse des taux proxy obligataire −12 % et marché −8 %; CAD +15 % face
au USD, soit USD/CAD −13,04 %. Le choc de taux n’invente pas de duration.
Le facteur technologie n’isole pas toute la croissance. Les autres actifs et
le change restent constants dans le scénario sectoriel.

`scripts/collect_fnb_stress.py` collecte les clôtures ajustées Yahoo avec contrôle
d’identité, devise, dates et valeurs extrêmes. Les périodes traversant un saut
suspect de plus de 50 % sont refusées; les périodes distinctes restent utilisables.
Un fonds doit avoir les deux dates exactes : son lancement n’est jamais avancé.
Les proxys US SPY/EFA/EEM sont convertis par prix USD × USD/CAD avant agrégation;
XIC sert de proxy Canada. Le facteur marché 2008 reconstruit l’allocation
**actuelle** de VEQT avec ces proxys; il n’est pas un historique réel de VEQT.

Pour les projections à plusieurs facteurs, les cinq stratégies existantes sont
complétées par XBB (taux), XCB − XGB (proxy crédit imparfait, durations différentes)
et USD/CAD. Au moins max(36, 4 × nombre de paramètres) observations communes
sont nécessaires. VIF >25 refuse l’estimation. Les effets FX empiriques ne sont
pas des ratios de couverture contractuels. Les séries CAD observées ne reçoivent
jamais un deuxième choc de conversion. Les rendements d’un levier quotidien ne
sont pas reconstruits par simple multiplication d’un choc de période.

Les classifications observé/reconstruit/modélisé/insuffisant sont publiées avec
leurs poids. Elles qualifient les sources des positions, pas un historique réel
du portefeuille actuel. Une décomposition marché/autres facteurs n’est fournie
que lorsque tous les termes projetés peuvent être réconciliés. Le résiduel n’est
pas simulé; un écart favorable non identifié n’est pas appelé diversification.
Aucun intervalle global de stress n’est donné sans modèle défendable.

### Régression, stabilité et mises à jour

Le module de droite conserve cinq facteurs, leurs écarts, bandes HAC Newey–West
à trois retards, contributions signées et résiduel. Les écarts dont la bande
contient zéro restent numériques et sont visuellement atténués. Le VIF est
signalé au-dessus de 10, refusé au-dessus de 25. Un R² élevé ne prouve pas la
qualité prédictive du modèle. Taille, autres styles, secteurs, taux et devises
non isolés peuvent rester dans le résiduel de cette régression à cinq facteurs.

La stabilité affiche 12 mois (non estimable avec cette politique de cinq facteurs),
24 mois (exploratoire, minimum 24 mois) et historique complet (minimum 36 mois).
Les fenêtres imbriquées sont comparées descriptivement; aucun test de changement
de régime n’est revendiqué.

Les portefeuilles 60/40 et 80/20 sélectionnent respectivement VBAL et VGRO;
les recommandations S&P 500 sélectionnent VFV. Le sélecteur permet ensuite
de changer explicitement la référence.

Daily FNB performance actualise les séries quotidiennes et les entrées de stress,
après la recherche mensuelle également. Le rendu partagé réinjecte ces sources
lors des publications complètes et rapides. Les données périmées restent datées;
les poids doivent correspondre à l’analyse courante avant tout affichage quotidien.
FEQT utilise la série officielle Fidelity de rendement total en valeur liquidative
sur toute la fenêtre; les autres FNB utilisent des clôtures ajustées Yahoo. Le
risque de prime/décote de marché de FEQT n’est donc pas capté. Pas de raccord de
prix entre fournisseurs. Les archives et registres de performance restent inchangés.

Références méthodologiques : [arch, bootstrap de séries temporelles](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html),
[statsmodels, covariance HAC](https://www.statsmodels.org/devel/generated/statsmodels.stats.sandwich_covariance.cov_hac.html),
[BSIF, risque de marché et proxys](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/capital-adequacy-requirements-car-2026-chapter-9-market-risk).
Ces références n’impliquent aucune certification réglementaire de SAVY.

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

# Aide à la décision FNB

Le bloc « Comparer pour choisir » occupe le haut de Vue d’ensemble. Il compare
trois candidats modifiables et une référence commune. Les anciennes perspectives
qualitatives à 2, 5 et 10 ans restent accessibles dans un volet repliable. Les
cartes Risque de perte et Facteurs gardent leurs dimensions.

## Objectif personnel et critères

L’objectif met en évidence un critère historique explicite : rendement annualisé
pour Croissance, Sharpe pour Compromis, CVaR à 21 séances pour Protection. Il ne
crée aucun score composite, aucune prévision, aucune allocation et aucun ordre.
Le classement financier existant et ses contraintes mensuelles sont conservés.
Les candidats initiaux viennent de ce classement; changer d’objectif ne les
remplace pas. Les références VBAL / FBAL utilisent le mandat 60/40; VGRO / FGRO
le mandat 80/20; les autres références utilisent les candidats de croissance.

Horizon, objectif, montant et seuil sont des préférences locales au navigateur.
Ils ne sont pas envoyés à un serveur. Le montant est synchronisé avec le
simulateur de capital existant. Un seuil de perte non renseigné ou invalide ne
produit aucun jugement de compatibilité. Les dépassements signalés portent sur
le drawdown du comparatif et les scénarios estimables. L’absence de dépassement
ne borne pas la perte future; les scénarios manquants restent signalés.

## Une convention commune dans le tableau

Lorsque tous les candidats et leur référence possèdent des séries quotidiennes
CAD totales complètes, contiguës et conformes aux poids actuels, toutes les
lignes utilisent les mêmes séances et les poids cibles quotidiens constants.
Pour n séances, le rendement annualisé vaut produit(1+r)^(252/n) − 1. La
volatilité est l’écart-type échantillonnal quotidien multiplié par racine(252).
Le Sharpe est (252 × moyenne quotidienne − taux sans risque annuel constant)
divisé par cette volatilité. Au moins 252 séances sont requises pour annualiser
le rendement et publier le Sharpe quotidien. Cette annualisation est une
convention; elle n’est pas un modèle de rendement futur.

Drawdown, VaR / CVaR et intervalles réutilisent le moteur Risque. La CVaR exige
24 blocs disjoints de 21 séances, alignés sur la clôture récente. Le nombre
d’observations de queue, sa fragilité et les intervalles bootstrap restent
visibles. Le RFG est informatif : les rendements sont déjà nets des frais
internes, sans deuxième déduction. Courtage et fiscalité restent exclus.

Si une série quotidienne n’est pas compatible, tout le tableau utilise le
backtest mensuel commun rééquilibré en janvier. Il ne mélange pas un Sharpe
mensuel pour un candidat avec un Sharpe quotidien pour un autre. La CVaR à
21 séances est alors indisponible. Les bêtas, downside capture et TE du volet
Protection gardent leur convention mensuelle existante, explicitement nommée.

## Sensibilité et explications

Les fenêtres utilisent les derniers 252 / 504 jours et l’historique complet
dans la base quotidienne, ou 12 / 24 mois et complet dans le repli mensuel.
Le rang ne compare que les candidats sélectionnés, référence exclue; les
égalités sont conservées. Ces fenêtres imbriquées ne sont pas indépendantes.

Le diagnostic local transfère au plus deux points de poids entre chaque paire
de FNB déjà détenus, sans vente à découvert, somme inchangée. Les autres
candidats restent à leurs poids initiaux. Il publie le nombre de variantes,
la plage du critère et des rangs, sans retenir une nouvelle allocation. Ces
perturbations ne garantissent pas le respect des contraintes de construction.
Elles ne sont pas calculées dans le repli mensuel, dont la convention annuelle
ne permet pas de mélanger simplement les rendements des fonds.

Chaque fiche possède une lecture repliable : raison de l’envisager, principales
contributions / concentrations, bêtas et facteurs estimés, points à réévaluer.
Les positions communes sont documentées parmi les dix premières sociétés
consolidées; ce n’est pas une mesure exhaustive de chevauchement. Un stress
construit sur le seul bêta ne démontre aucune diversification additionnelle.

## Après publication et actualisation

La colonne utilise uniquement `data/fnb-performance.json`, modèle
`buy_hold_fractional_ex_date_close_v1`, avec mêmes poids que la fiche et dates
propres au compte. La référence est rebasée à ces dates exactes. Une version
différente, un benchmark manquant ou une première clôture en attente restent
explicites. Le modèle commun depuis le 19 octobre, qui simule les ajouts tardifs,
est refusé comme source de cette colonne. Les dates de lancement différentes
ne sont pas classées ensemble; aucun rendement annualisé après quelques jours.

Un instantané enregistré est inclus lors du rendu; la page cherche la version
la plus récente au chargement, toutes les cinq minutes si visible et au retour
sur la page. Elle refuse une clôture plus ancienne et conserve l’instantané
daté si l’actualisation échoue. Les collecteurs, comptes figés et historiques
existants restent intacts.

## Correction de 2008

Des chocs absents, vides, non finis ou tous nuls sont refusés avant toute
projection. Ils produisaient auparavant une somme vide de zéro, incorrectement
publiée comme rendement modélisé. Les rendements historiques réellement
documentés restent prioritaires et utilisables. Une part géographique inconnue
n’est pas renormalisée silencieusement : la reconstruction de marché reste
indisponible et la collecte indique son caractère partiel.

Références : [CFA Institute, Backtesting & Simulation](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/backtesting-and-simulation)
et [Investment Model Validation](https://rpc.cfainstitute.org/research/foundation/2024/investment-model-validation).

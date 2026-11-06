# Conviction · Valeur FCUV et Momentum FCMO

Les deux dernières compositions retenues dans la conversation sont autorisées le 5 novembre et publiées le 6 novembre 2026 aux vues ordinaires d’Analyse FNB. Les poids sont conservés tels qu’acceptés, sans nouvelle optimisation.

| FNB | Valeur FCUV | Momentum FCMO |
|---|---:|---:|
| FINN | 20,0 % | 20,0 % |
| ZEM | 18,9 % | 18,6 % |
| FCUV | 14,9 % | — |
| FCMO | — | 15,0 % |
| VDY | 13,3 % | 16,3 % |
| XMTM | 8,4 % | 5,6 % |
| XBM | 8,0 % | 8,0 % |
| XCHP | 5,0 % | 5,0 % |
| XEG | 5,0 % | 5,0 % |
| ZEB | 4,5 % | 5,2 % |
| XGD | 2,0 % | 1,3 % |
| Total | 100,0 % | 100,0 % |

## Calculs et dates

Les fiches, sélecteurs, classements, montants, facteurs, mesures de risque et projections utilisent les moteurs communs. VFV en CAD représente le S&P 500. La sélection visait un bêta d’au moins 1,20 mesuré sur une fenêtre quotidienne récente; cette cible n’est ni un bêta constant ni celui de toutes les fenêtres mensuelles. Le bêta et les ratios affichés sont recalculés selon la période et la référence choisies.

XCHP a été lancé en septembre 2023. Le premier mois complet utilisé est octobre 2023. Les séries mensuelles des deux ajouts ont des valeurs nulles avant ce mois, puis 37 observations jusqu’en octobre 2026. Aucune interpolation, rendement nul, trésorerie fictive ni historique d’indice ne complète leur backtest avant création. Les historiques plus longs des autres portefeuilles restent intacts. Les ratios relatifs et facteurs emploient l’intersection des mois réellement disponibles. La période plus courte est affichée dans les tableaux et fiches; les statistiques de périodes différentes ne constituent pas une comparaison parfaitement homogène.

Le backtest rééquilibre en janvier, avec distributions réinvesties, comme les anciens portefeuilles. La croissance officielle BlackRock de XCHP ne fournit pas le point de septembre nécessaire au rendement d’octobre 2023. Ce seul mois est calculé avec ses clôtures CAD ajustées des 29 septembre et 31 octobre 2023, source Yahoo Finance conservée dans l’instantané. Les autres mois utilisent la croissance officielle. Les rendements acquis sont conservés lors des actualisations mensuelles.

Les risques quotidiens utilisent une même fenêtre observée pour tous, à partir d’octobre 2023, limitée par XCHP. Les projections conservent leur méthode commune : les observations manquantes d’un FNB récent y deviennent une projection géographique explicitement classée « modélisée », jamais un historique réel. Les primes futures de sélection rétrospective ne sont pas garanties.

## Suivi quotidien

Deux comptes distincts de 10 000 CAD sont inscrits au registre permanent. Publication avant ouverture le 6 novembre : lancement à la clôture du 6 novembre 2026, avec attente explicite jusqu’à validation. Les parts dérivent sans rééquilibrage; distributions et fractionnements sont traités par le moteur existant.

La comparaison commune rejoue ces poids depuis le 19 octobre 2026, comme les autres ajouts tardifs. Toute cette courbe est une simulation, sans raccordement au compte ouvert après publication. Les anciens comptes, pondérations, quantités et journées acceptées ne sont pas réécrits. Le calendrier existant actualise les deux nouvelles lignes automatiquement.

## Sources et contraintes

Les sept FNB ajoutés au modèle sont ZEM, FCUV, XMTM, XBM, XCHP, XEG et XGD. Les instantanés datés et les paramètres publics sont dans `data/fnb-submitted-sources/2026-11-05-conviction.json`. Les compositions figées et leur empreinte se trouvent dans `data/fnb-prospective/2026-11-05-conviction.json` et leur source dans `data/fnb-prospective-history/2026-11-05-conviction.json`.

Pour FCUV, la cotation correcte est FCUV.TO à la Bourse de Toronto. La ventilation d’actifs Fidelity de septembre comporte un résiduel signé; le mélange d’actifs utilise les positions d’actions positives détaillées plus récentes, et le solde non attribué est présenté avec les autres actifs. Les pays et secteurs proviennent de leurs relevés datés, normalisés conditionnellement aux actions. Aucun financement n’est déduit du résiduel signé.

Pour ZEM, la liste détaillée BMO couvre plus de 99 % de la valeur liquidative mais son nombre de lignes ne correspond pas au compteur publié. Cette couverture reste explicitement partielle : le site présente les positions identifiées sans certifier le nombre de sociétés ni le poids total des dix premières.

Ces allocations portent leurs propres contraintes : 30 % par FNB, XCHP 5 %, ZEB 15 %, écarts régionaux et sectoriels de ±15 points face à VEQT, sans emprunt ni FNB à levier. Ces paramètres ne modifient pas les contraintes archivées des anciennes recherches. Leurs résultats passés ont été consultés avant sélection; ils ne constituent pas un test indépendant ni une prévision de rendement.

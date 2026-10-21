# Sélections Robuste — 20 octobre 2026

Trois portefeuilles distincts sont ajoutés aux vues ordinaires d’Analyse FNB, sans remplacer les onze portefeuilles initiaux ni la proposition mensuelle.

| Sélection | Compromis du laboratoire | Noyau indiciel |
|---|---:|---:|
| Robuste 1 · Compromis | 100 % | 0 % |
| Robuste 2 · Diversifié | 70 % | 30 % |
| Robuste 3 · Noyau | 50 % | 50 % |

Le Compromis est celui de l’archive immuable `data/fnb-frontier-history/2026-10.json`, échantillon de calibration de 28 mois. Son Sharpe et son IR ont été plus cohérents entre le début et la fin de l’historique que les deux maxima de ratios. Le noyau vise des régions proches de VEQT : VFV 35 %, FCUQ 8 %, VCN 28 %, XEF 18 %, VEE 6 %, CGL.C 5 %. La poche américaine est répartie entre S&P 500 et qualité pour respecter le maximum de 35 % par FNB. Les fractions 100/70/50 expriment trois degrés de dépendance au modèle; elles ne maximisent pas les ratios récents.

Il s’agit d’un choix de construction et de trois variantes apparentées. Elles ne sont ni indépendantes, ni les trois meilleurs portefeuilles possibles d’un univers exhaustif. Le premier reste ma préférence de cette sélection; les deux autres réduisent les frais et les écarts régionaux. La sélection intervient après examen des 40 mois disponibles et des 12 derniers mois : ces derniers ne constituent donc plus un test indépendant. Le suivi prospectif est la vérification à venir. L’historique commun est court et ne couvre pas tous les régimes de marché.

## Calculs et suivi

Les fiches, ratios, expositions, courbes de risque et simulateur de montant emploient les mêmes 40 mois de rendements mensuels CAD, distributions réinvesties, avec remise aux poids cibles en janvier. Le laboratoire rééquilibre chaque mois; ses ratios peuvent donc différer pour les mêmes poids. Les poids exacts sont conservés sans arrondi de calcul, notamment aux limites géographiques. Les sources officielles de positions VFV et XMV complètent les fonds déjà disponibles; les sociétés communes sont consolidées.

Les contrôles affichent début 28 mois et derniers 3/6/12/24 mois, plus un contrôle daté du marché jusqu’au 20 octobre. Ce dernier simule les poids cibles au 30 septembre; il n’est pas un rendement prospectif. Les métriques historiques sont recalculées mensuellement en conservant tous les rendements acquis. Un signal de revue apparaît pour un IR 12 mois négatif, un retard cumulé sur 6 mois face à VEQT ou un dépassement des tolérances géographiques, sectorielles ou crypto.

Le catalogue de lancement `data/fnb-robust/2026-10-20.json` conserve les recettes, les pondérations complètes, les sources et leurs empreintes. Les contrôles utilisent les plafonds CGL.C 5 %, XIT 10 %, ZEB 10 %, ZEO 5 %, FINN 15 %, autres fonds 35 %, crypto totale 3 % FEQT comprise, régions et secteurs à ±10 points de VEQT et secteurs ≤35 %. La crypto est autorisée sans minimum; ces sélections en ont 0 %. VEQT et XEQT sont exclus des positions.

Trois comptes de 10 000 CAD sont inscrits au registre quotidien, à la première clôture admissible après publication. Publication après la fermeture du 20 octobre : lancement le 21 octobre, en attente tant que les clôtures ne sont pas validées. Aucun rendement antérieur n’est attribué à ces comptes. Les parts restent fixes, avec réinvestissement des distributions et traitement des fractionnements; aucun rééquilibrage. Les benchmarks sont ramenés à la même clôture de départ et les classements restent séparés par lancement. Toute révision d’allocation doit devenir une nouvelle version, sans réécrire ces comptes.

La revue mensuelle surveille également frais, recul maximal, concentration, sensibilité aux fenêtres et comparaison à FEQT. Le briefing du matin vérifie leur intégrité technique dans son contrôle de santé; la recherche FNB reste hors des actualités écrites et de la narration orale.

## Classement commun et choix du portefeuille

Le classement courant emploie désormais la même règle pour les treize candidats de croissance en actions (nº 1 à 9, proposition et trois Robuste). Il ne préfixe plus automatiquement les Robuste à l’ancien ordre manuel. Les mandats mixtes nº 10 et 11 restent comparés séparément. Les données mensuelles s’arrêtent au 30 septembre 2026; la date de recalcul ne constitue pas une actualisation des rendements jusqu’au jour courant.

Les candidats qui respectent les limites actuelles et n’ont ni IR négatif/indisponible sur douze mois ni retard cumulé sur six mois face à VEQT passent en premier. À l’intérieur de chacun des deux groupes, le score est le minimum des IR des fenêtres début 28 / derniers 24 / derniers 12 mois, plus le minimum des Sharpe de ces mêmes fenêtres, moins 25 fois le RFG annuel exprimé en décimal. Cette pénalité de préférence ne modifie pas les rendements déjà nets de frais. C’est une règle de comparaison explicite, non une probabilité, un modèle de prévision ou une preuve de robustesse. Les diagnostics sur trois mois servent d’alerte et tous les chiffres sont exportés. Les allocations historiques hors des nouvelles limites conservent leurs poids et leur historique, avec le motif de réévaluation affiché. Les fenêtres sont rétrospectives et se chevauchent.

« Portefeuille suivi » remplace maintenant le portefeuille précédemment suivi dans les deux graphiques, actualise les montants, la fiche et les expositions, et conserve les autres comparaisons choisies. Le suivi après publication possède un sélecteur distinct « Portefeuille à comparer » : il affiche ce compte avec son benchmark à la même date de lancement, y compris l’attente explicite d’une première clôture. Les deux classements gardent des buts distincts : préférence historique de robustesse et rendement effectivement suivi depuis le lancement.

## Sources

- [Archive méthodologique CFA Institute — validation des modèles](https://rpc.cfainstitute.org/research/foundation/2024/investment-model-validation)
- [Vanguard VFV](https://www.vanguard.ca/en/product/etf/equity/9563/vanguard-sp-500-index-etf)
- [iShares XMV](https://www.blackrock.com/ca/investors/en/products/239616/ishares-msci-canada-minimum-volatility-index-etf)
- Sources datées et paramètres complets dans chaque fiche et l’export JSON.

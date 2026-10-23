# Trois portefeuilles S&P 500 — 23 octobre 2026

Les compositions retenues dans la conversation sont conservées dans `data/fnb-recommended/2026-10-23-sp500.json` :

| FNB | Surperformance | Sharpe et or | Noyau VEQT |
| --- | ---: | ---: | ---: |
| ZNQ | 35 % | 35 % | 35 % |
| ZUQ | 22,6 % | 19,5 % | 11,4 % |
| VDY | 18,8 % | 9 % | 12,8 % |
| XEF | 12 % | 11,4 % | 8,2 % |
| VEE | 6,6 % | 6,3 % | 5,1 % |
| VCN | 5 % | — | — |
| ZLB | — | 8,8 % | — |
| CGL.C | — | 5 % | — |
| ZEO | — | 5 % | 5 % |
| VEQT | — | — | 20 % |
| VVL | — | — | 2,5 % |

VFV, cotation CAD non couverte avec distributions réinvesties, représente le S&P 500. Il est aussi admissible comme placement : son poids nul dans ces compositions n’est pas une exclusion de l’univers. Les anciens portefeuilles conservent VEQT comme référence. VEQT reste également la référence des limites géographiques et sectorielles; son plafond de détention de 40 % est réservé à ces trois ajouts.

Les fiches, sélecteurs, boussoles de risque, croissance, classements, expositions et positions sous-jacentes incluent les trois identités. Les ratios stockés et les diagnostics de ces ajouts utilisent VFV; le bouton de comparaison des trois sélectionne cette référence. Les tableaux interactifs peuvent toujours changer de référence explicitement.

Le backtest long couvre mars 2019 à septembre 2026 avec rééquilibrage annuel en janvier. Les rendements totaux officiels et leur provenance sont archivés dans `data/fnb-recommended-history/2026-10-23-sp500.json`, contrôlé par SHA-256. Les fenêtres avant/après 2024 ont déjà été examinées : elles sont rétrospectives et ne constituent pas un test indépendant. Taux sans risque constant de 2,37 %, frais internes inclus, courtage et fiscalité exclus.

Dans le suivi quotidien, chaque allocation part de 10 000 CAD à la clôture du 19 octobre 2026. Les trois courbes sont explicitement simulées depuis ce départ commun. Les registres permanents conservent la véritable date de publication et ne réécrivent aucune séance antérieure. Les parts sont conservées sans rééquilibrage dans ce suivi, avec distributions réinvesties. Les mises à jour quotidiennes et mensuelles incluent automatiquement les nouvelles identités, tout en préservant leurs pondérations figées.

# Laboratoire de frontière efficiente FNB

L’onglet **Frontière efficiente** est une simulation interactive indépendante
des allocations enregistrées et du suivi permanent. Aucune transaction n’est
envoyée, aucun compte de suivi n’est créé ou remis à zéro et aucune recommandation
mensuelle archivée n’est remplacée. Les préférences et poids explorés restent sur
l’appareil; l’export porte explicitement le statut de simulation.

## Données et calendrier

- Source : le même `data/fnb-analysis.json` que le reste d’Analyse FNB, sérialisé
  par `scripts/build_monthly_fnb.cjs`. Aucun nouvel abonnement ou service externe.
- Univers : `optimization.eligible_funds`, FNB d’actions cotés au Canada;
  démarrage avec tous les FNB admissibles, sans limite arbitraire de taille d’univers. VEQT est la référence fixe; VEQT et XEQT sont exclus des positions.
  Or, obligations, actions individuelles et FNB non admissibles ne sont pas ajoutés.
- Les sources et méthodes de chaque FNB sont visibles, notamment les éventuelles
  limites de reconstitution déjà documentées dans `data_methods`.
- Mêmes mois consécutifs et mêmes conventions de rendement total en CAD pour
  chaque FNB et VEQT. Aucun remplissage par zéro ou appariement par longueur seule.
- Par défaut, les 12 derniers mois sont exclus de la calibration si au moins
  36 mois existent. Dans l’instantané initial de 40 mois : calibration juin 2023
  à septembre 2025; validation octobre 2025 à septembre 2026.
- Les poids calculés sur la calibration sont appliqués tels quels à la validation.
  Les maxima, frontières et compromis ne consultent pas cette dernière. L’option
  historique complet supprime explicitement la validation séparée.
- Univers sélectionné aujourd’hui, paramètres explorés a posteriori et taux
  sans risque courant constant : ce découpage n’est pas un historique de décisions
  réellement publiées. Les essais répétés après consultation des résultats de
  validation peuvent eux-mêmes surajuster cette période.

## Convention et formules

Le mélange utilise des poids mensuels constants : `r_p,t = somme(w_i × r_i,t)`.
C’est un rééquilibrage mensuel théorique, distinct des backtests des autres
vues qui peuvent se rééquilibrer annuellement. Distributions réinvesties, frais
des fonds déjà compris; courtage et fiscalité personnelle exclus.

Sur `n` mois communs :

- Moyenne annualisée : `12 × moyenne(r_p)`; ce n’est ni un CAGR ni une prévision.
- Covariance annualisée : covariance échantillonnale (`n−1`) multipliée par 12.
- Volatilité : `sqrt(w' Σ w)`.
- Sharpe : `(moyenne annualisée − taux sans risque annuel) / volatilité`.
- Rendements actifs : `r_p,t − r_VEQT,t` à chaque même mois.
- Tracking error : écart-type échantillonnal des rendements actifs × `sqrt(12)`.
- IR : `12 × moyenne(r_p − r_VEQT) / tracking error`.
- CAGR informatif : `produit(1+r_p)^(12/n)−1`, présenté séparément du graphique.

Les ratios de dénominateur nul ou inférieur à la tolérance numérique sont non
définis. VEQT face à lui-même a donc un IR « — », jamais zéro ou l’infini.
Les mois de validation utilisent les mêmes formules et le même taux constant.

## Optimisation et interactions

Poids positifs, somme 100 %, plafond général initial de 35 % par FNB. Les plafonds propres aux fonds restent contraignants : 35 % en général, 15 % FINN, 5 % ZEB/ZEO/XIT. Régions et secteurs : ±10 points de VEQT; maximum sectoriel 35 %. Les planchers régionaux du modèle mensuel sont conservés (30 % US, 15 % Canada, 15 % développés hors Amérique du Nord, 5 % émergents), avec les mêmes plafonds de 60/40/40/20 % et 5 % de pays non publiés. Les expositions sont normalisées sur la poche actions, après liquidités internes. Le plafond est
modifiable, mais un univers dont le nombre de FNB rend la contrainte impossible
est refusé clairement. Toutes ces contraintes sont appliquées à la frontière, au nuage et aux interactions.

`js/fnb-frontier-utils.js` trace les programmes quadratiques convexes
`min 0,5 w’Σw − λμ’w` sur le polytope complet des contraintes. Dykstra trouve seulement un point initial admissible; un solveur à ensemble actif résout ensuite les systèmes KKT directement, afin d’éviter l’inversion instable d’actifs très corrélés. Une régularisation numérique de 1e−10 assure les directions; le résidu primal/dual est calculé sur la covariance originale. Une non-convergence bloque la publication du point. Le nuage est formé de mélanges convexes d’allocations admissibles; il ne remplace pas la frontière.

La frontière active remplace `Σ` par la covariance des rendements de chaque
FNB moins VEQT. Les maxima de Sharpe et d’IR **positifs et finis** sont cherchés
sur leurs frontières respectives et affinés dans le paramètre `λ`. Un maximum
indisponible est signalé; les rendements ne sont jamais modifiés pour le rendre
positif.

Le compromis sélectionne, parmi les allocations calculées et leurs mélanges,
un point non dominé dans le plan Sharpe/IR. Son curseur pondère deux scores
normalisés dans cet échantillon. Il ne représente pas une frontière multicritère
exhaustive ni une maximisation simultanée garantie des deux ratios.

Déplacer un poids cherche à atteindre la cible, puis réajuste les autres poids avec une projection quadratique sous toutes les contraintes. La cible peut être limitée lorsqu’une exposition bloque le mouvement. Les colonnes `Δ Sharpe` et `Δ IR`
recalculent l’effet d’un ajout de **1 point de poids**, financé par les autres
FNB; « — » si un plafond ou une contrainte d’exposition empêche cet ajout complet. Il s’agit d’une
sensibilité locale du mélange historique, pas d’une attribution causale ou
d’une garantie de création de valeur future.

Le calcul des frontières est isolé dans `fnb-frontier-worker.js`. Les réponses
anciennes sont ignorées, les calculs précédents sont interrompus lors d’un
changement de paramètres, et les manipulations des poids ne relancent pas le
solveur. Le générateur mensuel réinstalle automatiquement la vue dans chaque
nouvel instantané; les archives anciennes conservent leurs données sérialisées.

## Vérifications

`npm test` inclut des tests d’optimum analytique, comparaison à une grille dense,
contraintes, calculs indépendants des ratios, zéro dénominateur, séparation de la
validation et absence de mutation des données d’origine.
`tests/frontier-browser.cjs` vérifie worker, glisser et curseurs, maxima distincts,
plafond, validation, export, persistance et formats 320–1440 px. Les suites FNB
et portail vérifient aussi la vue intégrée et son absence de second défilement.

Références : [optimisation moyenne–variance, CVX](https://www.cvxgrp.org/cvx_short_course/docs/applications/notebooks/portfolio_optimization.html)
et [ratio d’information, CFA Institute](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/using-multifactor-models).

## Univers élargi et publication

`data/fnb-frontier-model.json` ajoute VFV, VVL, XIC, XIT, XMU, XMV, XMW, XQQ, XSU, XUU, ZLU et ZUQ. Les collecteurs officiels déjà utilisés dans « Sources et dates » alimentent `data/fnb-frontier-universe.json`. Les mois sont exactement ceux de l’analyse; aucun proxy ni remplissage n’est ajouté. Le fichier conserve les sources, méthodes, dates, devises et expositions. Le laboratoire inclut aussi RUD, déjà documenté dans les sources, soit 28 FNB au lancement de cette extension.

Le rapport sérialise cette extension séparément de `#analysis`; les allocations et historiques acquis restent intacts. Le générateur ajoute les nouvelles lignes dans « Données → Sources et dates » et les contrôles d’exposition dans le laboratoire. Le workflow `Expanded FNB frontier sources` vérifie quotidiennement l’alignement avec le dernier instantané mensuel et réessaie une collecte incomplète, sans publier de données partielles. Les archives gardent leurs instantanés.

Les tests couvrent les contraintes de tous les points, un optimum comparé à une grille dense, les curseurs, les mois manquants et le traitement des lignes de droits à valeur nulle chez BMO. Six programmes quadratiques sont également recoupés avec SciPy/SLSQP, indépendamment du solveur du navigateur. La comparaison de trois profils présente calibration et validation côte à côte; les compositions peuvent être dépliées.

Le modèle de recherche mensuelle accepte également ces 12 candidats à partir de sa prochaine publication. L’introduction d’un nouveau FNB exige un historique officiel complet sur les mois communs; les séries déjà acquises restent inchangées. VEQT et XEQT ne peuvent plus être sélectionnés comme positions de la proposition mensuelle. Les recommandations mensuelles déjà archivées restent inchangées.

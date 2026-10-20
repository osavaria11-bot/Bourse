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
  démarrage avec les FNB de la proposition existante. VEQT est la référence fixe.
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

Poids positifs, somme 100 %, plafond initial de 40 % par FNB. Le plafond est
modifiable, mais un univers dont le nombre de FNB rend la contrainte impossible
est refusé clairement. Ce plafond ne garantit pas la diversification des
expositions économiques sous-jacentes.

`js/fnb-frontier-utils.js` trace des programmes quadratiques convexes
`min 0,5 w'Σw − λμ'w` sur le simplexe borné. Les pas de coordonnées par paires
préservent le budget et les bornes; l’écart de Frank–Wolfe contrôle l’optimalité
de chaque résolution. Une résolution non convergée produit une erreur plutôt
qu’une fausse frontière. Le nuage déterministe d’allocations n’est pas utilisé
comme substitut à la frontière moyenne–variance.

La frontière active remplace `Σ` par la covariance des rendements de chaque
FNB moins VEQT. Les maxima de Sharpe et d’IR **positifs et finis** sont cherchés
sur leurs frontières respectives et affinés dans le paramètre `λ`. Un maximum
indisponible est signalé; les rendements ne sont jamais modifiés pour le rendre
positif.

Le compromis sélectionne, parmi les allocations calculées et leurs mélanges,
un point non dominé dans le plan Sharpe/IR. Son curseur pondère deux scores
normalisés dans cet échantillon. Il ne représente pas une frontière multicritère
exhaustive ni une maximisation simultanée garantie des deux ratios.

Déplacer un poids fixe celui-ci puis redistribue le reste proportionnellement,
avec projection sous le même plafond. Les colonnes `Δ Sharpe` et `Δ IR`
recalculent l’effet d’un ajout de **1 point de poids**, financé par les autres
FNB; « — » si le plafond ne permet pas cet ajout complet. Il s’agit d’une
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

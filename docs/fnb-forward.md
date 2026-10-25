# Projections FNB : lecture et hypothèses

## Lecture visible

Le mode Prospectif réutilise le comparateur des trois candidats. Son tableau
montre le **passé simulé**, la **projection annuelle médiane**, le montant final
et sa fourchette, la fréquence de dépassement de VFV et le risque de recul de
30 % pendant le placement. Les références VFV, FEQT, VEQT restent comparables
sur les mêmes trajectoires. Les frais figurent sous les noms. Les chiffres de
projection sont agrandis; les textes secondaires font au moins 13 px. Les
cartes de risque/facteurs existantes gardent leurs dimensions.

Les rangs 1/2/3 fondés sur de faibles écarts centraux sont retirés de cette vue.
Quand le contraste conditionnel des moyennes ne départage pas les candidats,
le résumé dit « Rendements proches : pas de gagnant clair ». Les anciens
classements et les objectifs du mode Historique restent disponibles. Les
probabilités détaillées, les calculs et les diagnostics sont repliés.

Une base de rendement explicite est sélectionnable. Le choix et tous les
paramètres sont des préférences du navigateur; aucun portefeuille, poids,
compte enregistré, suivi après publication ou rendement historique n’est modifié.

## Deux bases de rendement

**Historique long · CAD**, par défaut : rendements totaux des proxys déjà
collectés depuis 2008. États-Unis SPY converti CAD, Canada XIC, développés EFA
converti CAD, émergents EEM converti CAD, obligations XBB. Une période commune,
contiguë, complète d’au moins 120 mois est requise. Le taux géométrique est
`exp(12 × moyenne(log(1+r_m))) − 1`. La date de départ et la date de fin sont
visibles. Il s’agit d’une extrapolation historique conditionnelle, pas d’une
prévision démontrée ni d’un historique réel des FNB récents.

Les proxys sont nets de leurs propres frais. Avant leur emploi comme vues
avant frais, une approximation de ces frais est réintégrée :
`(1+CAGR_net) × exp(frais_proxy) − 1`. Frais courants vérifiés le 25 octobre 2026 :
SPY 0,0945 %, XIC 0,06 %, EFA 0,32 %, EEM 0,72 %, XBB 0,10 %. Les frais sont
supposés constants sur le passé : les frais historiques ont pu différer. Les
frais actuels des FNB réellement détenus sont ensuite déduits une seule fois.
Cette normalisation approximative ne transforme pas les proxys en indices
bruts exacts et ne réintègre pas les retenues fiscales étrangères.

Sources primaires des frais :

- [SPY, State Street](https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy)
- [XIC, BlackRock](https://www.blackrock.com/ca/investors/en/literature/fact-sheet/xic-ishares-core-s-p-tsx-capped-composite-index-etf-fund-fact-sheet-en-ca.pdf)
- [EFA, iShares](https://www.ishares.com/us/products/239623/ishares-msci-eafe-etf)
- [EEM, iShares](https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf)
- [XBB, BlackRock](https://www.blackrock.com/ca/investors/en/products/239493/ishares-canadian-universe-bond-index-etf)

**Repères prudents · FP 2026** : [Institut PF / FP Canada](https://institutpf.org/normes-hypotheses-projection),
publication du 30 avril 2026, nominal avant frais, dix ans ou plus : liquidités
2,4 %, obligations 3,2 %, actions CA 6,3 %, US 6,4 %, développés 6,6 %, émergents
7,5 %, inflation 2,1 %. Leur emploi à deux ou cinq ans est identifié comme une
hypothèse prudente de scénario, et non comme une anticipation propre à cet
horizon. Si l’historique long est insuffisant, le repli vers ces repères est
explicite, sans fausse moyenne historique.

Or et crypto : croissance auxiliaire 0 % dans les vues des benchmarks, hypothèse
non sourcée. Les pays non publiés utilisent un proxy US, sans renormalisation
silencieuse. Liquidités : repère de 2,4 %. Les rendements des portefeuilles
résultent du posterior, pas d’une moyenne arbitraire de leurs CAGR récents.

Le [S&P décrit environ 10 % annualisés, distributions comprises, depuis 1957](https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-brochure.pdf).
Ce repère en USD ne constitue pas une prévision à deux ans en CAD. La période,
la devise, les frais et le mode de calcul expliquent des différences avec le
tableau. Le tableau juxtapose le backtest récent et la projection pour rendre
ces différences examinables.

## Avance récente : scénario optionnel

Par défaut, **aucune avance future de stratégie n’est présumée**. Un portefeuille
à bêta plus faible ou plus coûteux peut donc avoir une projection inférieure au
benchmark, même si son backtest récent a été supérieur. Ce constat dépend de
l’hypothèse; il ne démontre aucune infériorité future de la stratégie.

Dans « Pourquoi ces projections ? », l’utilisatrice peut conserver au départ
0 / 25 / 50 / 100 % de l’avance récente estimée. Ce paramètre est une **hypothèse
de scénario**, sans prétention de persistance calibrée. L’avance diminue de
moitié tous les 24 mois : `a_t = c × a_0 × exp(-ln(2) × t/24)`.

L’avance est la moyenne mensuelle des log-rendements excédentaires ajustés du
bêta par rapport à VEQT et de la composante sans risque. Les frais du relevé des
positions sont réintégrés avant l’estimation afin de ne pas les charger une
seconde fois comme alpha; les frais futurs sont appliqués au rendement de base.
Les frais de calibration sont maintenus constants, faute de vintages complets.

Elle est estimable seulement avec au moins 36 mois de rendements réels communs
et des positions entièrement observées. Un FNB récent reconstruit ne reçoit
aucune avance historique inventée. Les vecteurs d’avances sont rééchantillonnés
**conjointement par blocs** pour conserver l’incertitude des moyennes. Un flux
aléatoire séparé maintient les trajectoires de marché appariées entre scénarios
avec/sans avance. La même règle s’applique aux benchmarks. Le tirage de l’avance
et celui des moyennes BL sont supposés indépendants, approximation conditionnelle.

Le résumé ne réutilise pas l’intervalle du modèle de base pour prétendre départager
statistiquement des scénarios d’alpha manuel. Les comparaisons de moyennes sont
alors marquées comme portant sur la base, sans verdict de significativité.
Les portefeuilles ont été sélectionnés rétrospectivement : une avance de backtest
peut refléter la sélection après coup, et ne valide pas la stratégie.

## Black-Litterman et facteurs

La covariance annualisée Σ réutilise `SavyFrontierUtils.moments` sur les rendements
mensuels des positions aux poids actuels constants. Prior excédentaire Π=δΣw,
où w désigne VEQT et δ sa prime de référence divisée par sa variance. VEQT est
un proxy d’équilibre avec biais canadien, pas le portefeuille mondial capitalisé
exhaustif. Les ancrages géométriques sont convertis en approximation arithmétique
par variance/2. Les poids des portefeuilles ne sont pas optimisés.

Trois vues absolues VFV/FEQT/VEQT, fondées sur leurs répartitions, partagent
leurs erreurs par région. Ω est corrélée; les trois vues ne sont pas trois
sources indépendantes. Erreur-type supposée par défaut 3 pp/an pour les actions,
modificateurs 0,5 pour les obligations et 0,2 pour les liquidités. Ce sont des
hypothèses explicites, pas des scores de confiance. τ=12/n sur n mois.

[He et Litterman, 1999](https://people.duke.edu/~charvey/Teaching/BA453_2002/GS_The_intuition_behind.pdf) :

`μ = Π + τΣ Pᵀ (P τΣ Pᵀ + Ω)⁻¹ (Q − PΠ)`

`M = τΣ − τΣ Pᵀ (P τΣ Pᵀ + Ω)⁻¹ P τΣ`

Rendement arithmétique net : taux sans risque + μ − RFG actuel. Le drift historique,
déjà net de frais, est retiré des innovations. Une moyenne conditionnelle depuis
N(μ,M) est tirée une fois par trajectoire : son incertitude ne disparaît pas à
dix ans ni avec le nombre de simulations. Les frais, expositions, méthodes et
sources sont figés au dernier relevé. Impôts, courtage et flux externes exclus.

Régressions QR/HAC existantes, minimum max(36,4×nombre de paramètres), refus VIF>25.
Facteurs : marché VEQT; VVL−VEQT; ZNQ−VFV (growth/technologie, proxy imparfait);
VMO−VEQT; FCUQ−VFV; FCUL−VFV; XBB; XCB−XGB (duration imparfaite); USD/CAD.
Les coefficients non significatifs restent atténués et chiffrés. Pas de
régression forcée si taille ou colinéarité insuffisante. Les primes futures de
style sont nulles dans la base; valorisations et bénéfices prévisionnels ne sont
pas disponibles dans les sources actuelles et ne sont pas inventés.

Priorité des sources par position : réel CAD total; indice mensuel représentatif
validé, daté et documenté; sinon projection des expositions actuelles sur proxys
existants. Cette dernière est modélisée, pas observée avant le lancement du FNB.
Les répartitions complètes sont requises; crypto non reconstruisible et régions
inconnues >2 % sont refusées. Styles, levier et couvertures manquants restent des
limites. Le registre d’indices peut rester vide. Le backtest affiché provient des
résultats existants, distinct du compte réel après publication.

## Trajectoires et queues de distribution

Au moins 25 000 trajectoires centrales communes. `forward_history` conserve les
proxys téléchargés par le collecteur de stress existant, sans nouveau service.
À une fermeture américaine sur une date TSX ouverte : dernière clôture US connue,
maximum quatre jours, avec FX à la date de valorisation, jamais un prix futur.
Mois incomplets, trous et erreurs de prix exclus, sans zéro de remplacement.

Avec ≥120 mois de proxys contigus et ≥36 mois communs pour les sensibilités,
régression de log-rendements sur marché géographique, taux, crédit, FX. Bootstrap
circulaire joint de blocs de trois mois par défaut sur les facteurs longs, et
rééchantillonnage joint des résidus récents, indépendamment des facteurs longs.
Les queues empiriques et grappes de volatilité des crises sont conservées;
ruptures de bêta et risques de style absents du court historique peuvent manquer.
Une régression non estimable utilise les innovations conjointes récentes. Sans
proxys longs valides, repli récent documenté, avec crises absentes non calibrables.

Drift logarithmique : `log(1+μ_net)/12 − variance_log_mensuelle/2`, approximation
de conversion des moments, sans innovations normales imposées, plus l’éventuel
scénario d’avance récente. Les produits mensuels rendent les horizons distincts.
Ce modèle statistique de rendements agrégés aux poids cibles constants n’est pas
une comptabilité de rééquilibrages annuels position par position.

VIX frais / volatilité US réalisée récente : ajustement indicatif temporaire,
borné entre 0,75 et 1,5, décroissant sur douze mois. Autres observations macro :
contexte, sans transformation arbitraire en rendement. Données périmées exclues
de cet ajustement. Quatre régimes expansion/ralentissement/récession/crise et
leurs transitions ne sont pas estimables avec les seuls quarante mois communs.
Le repli bootstrap reste documenté; aucune probabilité de régime n’est inventée.

Mêmes tirages entre candidats et benchmarks, préfixes 2/5 ans conservés à dix ans,
indépendance de la sélection de candidats et chemins identiques pour allocations
identiques. Aucun effet de corrélation artificiel ajouté aux rendements agrégés.

## Sorties et validation

Moyenne des CAGR simulés, CAGR médian, cumulés P10/P50/P90, gain final,
seuils annualisés 8/10/15 %, surperformance appariée VFV/FEQT/VEQT et écart
annualisé moyen, valeur médiane et moyenne pour 100 000 CAD. Les montants du
tableau suivent le capital choisi. Les drawdowns sont observés aux fins de mois;
les creux intramensuels peuvent être plus profonds. Perte finale et drawdown
pendant le placement restent distincts. Les fourchettes encadrent 80 % des
trajectoires conditionnelles et ne sont pas des bornes garanties.

Sensibilité : vues ± erreur-type, volatilité +25 %, dépendance accrue au marché
commun à variance marginale conservée. Crise initiale −35 %×bêta, bornée −80 %,
testée séparément sans probabilité attribuée. 2 500 trajectoires par variante;
les min/max sont des bornes de sensibilité, pas des intervalles calibrés.

Walk-forward croissant, entraînement ≥24 mois, prochain mois jamais utilisé pour
ajuster la prévision. Les taux historiques sont **recalculés avec les seuls
mois antérieurs à chaque origine**; les prix futurs ne définissent pas le prior
passé. Les repères FP2026 ne sont évalués qu’après avril 2026. Les trois modèles
(moyenne récente, marché seul, hybride sélectionné) sont comparés sur les mêmes
mois éligibles : RMSE, MAE, Brier, couverture 80 %. Macro actuelle désactivée.
L’éventuelle avance est estimée sur le seul entraînement, à partir de 36 mois.

Avec les données actuelles, la base historique a seize mois de rejeu commun,
et la base FP2026 cinq. Les allocations, expositions et frais actuels sont
maintenus : sélection, survivance et absence de vintages empêchent d’en faire
une validation de la stratégie effectivement publiée. Ce test à un mois ne
calibre pas le simulateur complet à 2/5/10 ans. Aucune meilleure précision n’est
revendiquée. Le suivi réel après publication reste indépendant.

## Exécution et vérifications

Worker annulable, cache mémoire/session versionné incluant séries, poids, frais,
expositions, sources, base, persistance, horizon et candidats. Capital et objectif
historique ne relancent pas les trajectoires. Le collecteur quotidien et le build
existants mettent à jour les données; aucune dépendance ni service payant ajouté.

Tests : BL analytique, vues corrélées, matrices singulières, identités, frais une
fois, bases explicites et horizons, proxys courts <12/24/36 mois, absence d’alpha
inventé, prix futurs exclus des priors de walk-forward, scénarios de persistance,
préfixes, seuils/drawdowns, 25 000 chemins aux trois horizons, UI lisible et détails
repliés, sources sélectionnables, Chromium/WebKit et 320/375/768 pixels.

# SAVY : modèle prospectif conditionnel

Le comparateur existant propose **Historique / Prospectif** et les horizons
2, 5, 10 ans. Son tableau et ses contrôles sont réutilisés; les cartes de risque
et de facteurs conservent leurs dimensions. Les trois candidats restent
modifiables, avec VFV, FEQT, VEQT et la référence sélectionnée sur des trajectoires
communes. Les comptes enregistrés, allocations et backtests existants ne sont
jamais modifiés. Le mode et les hypothèses sont des préférences du navigateur.

## Ce qui est implémenté, ce qui ne l’est pas

Le moteur combine un posterior **Black-Litterman**, des sensibilités
multifactorielles estimées et un **bootstrap joint par blocs**, avec 25 000
trajectoires centrales. Il utilise les proxys totaux CAD depuis 2008 lorsque
leur couverture est suffisante. Il n’est pas un modèle économique à quatre
régimes calibrés : expansion, ralentissement, récession et crise ne peuvent
être identifiés et validés sur les 40 mois communs des stratégies. Ce repli est
explicite dans la vue principale. Aucune matrice de transition ni probabilité
de crise n’est inventée.

Les anticipations de valorisation, bénéfices futurs ou inflation conditionnelle
ne sont pas disponibles dans les flux actuels. Aucune transformation arbitraire
d’un indicateur macro en rendement attendu n’est ajoutée. Le moteur accepte
une vue actions supplémentaire et une erreur-type déclarée. Les observations
macro actuelles sont datées et reliées à leurs sources; le VIX récent ajuste
temporairement la volatilité. Les primes futures de value, growth, momentum,
quality, low-vol et change sont nulles par défaut, sans reprise du fort alpha
récent. Un FNB peut avoir une forte sensibilité de risque sans prime de rendement
future établie.

## Ancrages et Black-Litterman

Source primaire : [Institut PF / FP Canada, normes 2026](https://institutpf.org/normes-hypotheses-projection),
publiées le 30 avril 2026, repères nominaux avant frais pour 10 ans et plus :
liquidités 2,4 %, obligations 3,2 %, actions CA 6,3 %, US 6,4 %, développés 6,6 %,
émergents 7,5 %, inflation 2,1 %. L’application à 2/5 ans est une hypothèse,
pas une prévision institutionnelle à court terme. Dans les vues des benchmarks, or et crypto : ancrage
auxiliaire 0 %, explicitement sans source de rendement attendu; le posterior
des portefeuilles dépend aussi du prior de risque de marché. Les pays non
publiés utilisent le proxy US, sans renormaliser les régions connues.

Les séries de calibration sont les rendements mensuels des positions agrégés
aux **poids actuels constants**. Le calcul ne réutilise pas les CAGR historiques
comme espérances futures. La covariance annualisée Σ réutilise
`SavyFrontierUtils.moments`. Le prior de rendement excédentaire est Π=δΣw,
où w désigne VEQT dans cet espace et δ sa prime géographique de référence
(convertie en approximation arithmétique par +variance/2), divisée par sa
variance. VEQT est un proxy d’équilibre avec biais canadien, pas le marché
mondial capitalisé exhaustif. Les poids des portefeuilles ne sont pas optimisés.

Les trois vues absolues VFV/FEQT/VEQT viennent de leurs répartitions réelles,
des ancrages par classe, et de la vue actions optionnelle. Ces trois vues
partagent les mêmes ancrages : Ω comprend leurs **erreurs corrélées** par
région; elles ne comptent pas comme trois sources indépendantes. Erreur-type
par défaut 3 pp/an pour les vues actions, modifiable, facteur 0,5 pour les
obligations et 0,2 pour les liquidités : **hypothèses non calibrées**, sans
score de confiance. τ=12/n représente l’incertitude du prior sur n mois.

Le posterior suit la formule de [He et Litterman (1999)](https://people.duke.edu/~charvey/Teaching/BA453_2002/GS_The_intuition_behind.pdf) :

`μ = Π + τΣ Pᵀ (P τΣ Pᵀ + Ω)⁻¹ (Q − PΠ)`

`M = τΣ − τΣ Pᵀ (P τΣ Pᵀ + Ω)⁻¹ P τΣ`

Le rendement arithmétique annuel net vaut taux sans risque + μ − RFG actuel.
Le drift historique, déjà net des frais, est entièrement retiré des innovations;
le RFG entre une seule fois dans le nouveau drift prospectif. Les frais,
expositions et sources sont figés au dernier instantané. Fiscalité, courtage,
flux externes et évolution future des frais ne sont pas simulés.

## Expositions et FNB récents

La régression QR/HAC existante est réutilisée, avec contrôle VIF et minimum
max(36, 4×nombre de paramètres). Neuf sensibilités : marché VEQT; VVL−VEQT;
ZNQ−VFV (growth **et technologie**, proxy imparfait); VMO−VEQT; FCUQ−VFV;
FCUL−VFV; XBB; XCB−XGB (duration imparfaite); USD/CAD. Une régression non
identifiable reste absente; les coefficients non significatifs sont atténués,
sans supprimer leur valeur ni leur erreur-type robuste.

Priorité pour chaque position : rendements réels CAD disponibles; sinon indice
mensuel représentatif explicitement validé, documenté, CAD total; sinon projection
géographique des expositions actuelles vers les proxys existants. Cette dernière
reste **modélisée**, pas un historique du FNB. Elle exige des poids et une
répartition complète, refuse les crypto non reconstruisibles et les régions
inconnues >2 %. Les styles, couvertures et leviers non reconstruits sont des
limites; aucune reconstruction détaillée des titres individuels n’est revendiquée.
Le registre d’indices peut rester vide. Les dates antérieures au lancement
ne sont jamais ajoutées aux séries réelles du FNB. Les proportions observées,
reconstruites et modélisées concernent les données de calibration, pas une
prétendue observation du futur.

## Trajectoires et risques extrêmes

Le collecteur de stress conserve désormais les téléchargements déjà effectués
sous `forward_history`. SPY/XIC/EFA/EEM, XBB/XCB/XGB et USD/CAD servent de proxys.
Les prix ajustés US sont convertis en CAD. Une fermeture US à une date de
valorisation TSX utilise la dernière clôture US connue (maximum quatre jours),
avec FX à la date de valorisation, jamais un prix futur. Les mois incomplets,
trous et erreurs de prix restent exclus; pas de zéro de remplacement. Les
historiques de proxys sont distincts des historiques de FNB et de portefeuille.

Avec au moins 120 mois de proxys contigus et 36 mois communs pour les
sensibilités, une régression de log-rendements sur marché mondial géographique,
taux, crédit, FX estime les expositions actuelles. Les innovations des quatre
proxys longs sont rééchantillonnées conjointement par blocs circulaires de
3 mois par défaut. Les résidus contemporains des portefeuilles sont aussi
rééchantillonnés **ensemble**, indépendamment du bloc de facteurs longs (hypothèse
conditionnelle). Les queues empiriques et grappes de volatilité des années de
crise sont ainsi retenues. Le risque de style hors du court échantillon et les
changements de bêta peuvent manquer. Une régression non estimable utilise les
innovations conjointes récentes. Sans proxys longs valides, tout le moteur
revient au bootstrap joint récent, avec avertissement sur les crises absentes.

Les innovations sont centrées; le drift logarithmique utilise
`log(1+μ_net)/12 − variance_log_mensuelle/2`, approximation lognormale de
conversion des moments, sans supposer des innovations normales. Les produits
mensuels rendent les horizons distincts. Les rendements agrégés suivent un
modèle statistique de poids cibles constants; ce n’est pas une comptabilité
position par position de rééquilibrages annuels.

Une moyenne annuelle multivariée conditionnelle est tirée **une fois par
trajectoire** depuis N(μ,M) : son incertitude persiste à 10 ans, au lieu de
disparaître avec le nombre de simulations. Cette distribution dépend des
hypothèses de prior et de vues et n’est pas calibrée au sens fréquentiste.
Le VIX US frais / volatilité US réalisée récente ajuste le premier risque
mensuel, borné entre 0,75 et 1,5 et décroissant exponentiellement sur 12 mois;
transfert indicatif au risque CAD, explicite. Les autres données macro sont du
contexte. Une donnée périmée n’alimente pas cet ajustement.

Mêmes tirages, mêmes facteurs et mêmes tirages de moyenne pour tous les
candidats et benchmarks. Les graines par trajectoire conservent les préfixes
2/5 ans d’un calcul à 10 ans; la sélection de candidats ne change pas les
moyennes ou les trajectoires d’un autre portefeuille. Aucun terme de
corrélation n’est ajouté à un rendement agrégé; les dépendances influencent
la distribution des risques. Des portefeuilles identiques ont des chemins
identiques, sans jitter indépendant.

## Sorties, classement et sensibilité

Les sorties comprennent moyenne des CAGR simulés (rendement annualisé attendu),
CAGR médian, cumulés P10/P50/P90, probabilité de gain final, seuils annualisés
8/10/15 %, surperformance appariée des trois benchmarks et écart annualisé moyen,
valeur médiane et espérance finale pour 100 000 CAD. Les montants visibles
suivent aussi le capital choisi. Une perte finale de 30 % est distincte d’un
recul de 30 % pendant l’horizon. Les drawdowns sont calculés aux fins de mois,
et sous-estiment potentiellement les creux intramensuels.

Le classement global utilise les couches de dominance de Pareto : médiane,
P10, perte finale, recul P90, dépassement de VFV et frais. Un rang ne repose
pas sur une somme opaque de ratios. Les forces par candidat restent visibles;
plusieurs candidats peuvent partager un compromis non dominé. Les différences
de moyennes dont la plage conditionnelle 95 % contient zéro sont signalées
comme difficiles à départager, même si l’ordre central diffère. Cette plage
est conditionnelle aux hypothèses BL et ne prouve pas l’égalité future.

Les bornes de sensibilité varient vues actions ± erreur-type déclarée,
volatilité +25 %, et dépendance accrue au marché commun (mélange 50 %, variance
marginale préservée). Une crise initiale −35 % × bêta, bornée −80 %, est testée
séparément **sans lui attribuer de probabilité**. Les variantes ont 2 500
trajectoires appariées chacune; le central en a au moins 25 000. Leurs min/max
sont des bornes de sensibilité, pas des intervalles statistiques calibrés.

## Validation et limites

Walk-forward à fenêtre croissante : entraînement sur les seuls mois précédents,
minimum 24, prévision du mois suivant. Comparaison à une moyenne historique et
un modèle de marché seul : RMSE, MAE, Brier gain/perte et couverture P10–P90.
Les ancrages publiés le 30 avril 2026 ne sont pas rétrodatés. Les tableaux des
trois modèles utilisent les mêmes mois depuis mai 2026 : **5 mois actuellement**.
La macro courante n’entre pas dans ce rejeu. Ce test de moyenne/distribution à
un mois ne valide pas la calibration du simulateur complet à 2/5/10 ans.

Les allocations ont été sélectionnées rétrospectivement; leurs expositions
actuelles servent au rejeu. Biais de sélection, survivance de l’univers,
révisions de données et absence de vintages ne peuvent être éliminés. Ce n’est
pas une validation de la stratégie de sélection après publication. Aucun avantage
prédictif ni calibration à long terme n’est revendiqué sur cet échantillon.
Le suivi réel depuis publication reste indépendant et inchangé.

## Exécution, cache et tests

`fnb-forecast-worker.js` effectue les calculs hors du fil principal. Les anciens
travaux sont annulés au changement de paramètres; un résultat tardif ne peut
remplacer une autre sélection. Cache mémoire et de session : version du modèle,
empreinte des séries/allocations/frais/expositions/proxys/macro, horizon, candidats
et hypothèses. Capital et objectif réutilisent les trajectoires. Aucun service
payant ni dépendance ajouté. Le repli sans Worker utilise le même moteur.
Le collecteur quotidien existant réactualise les proxys et le build incorpore
le dernier instantané macro. Les anciennes archives restent utilisables.

Tests numériques : posterior BL analytique, erreurs de vues corrélées, matrices
singulières, actifs identiques, commissions une fois, hypothèses et sources,
FNB <12/24/36 mois, hiérarchie des proxys, échantillons insuffisants, 25 000
chemins aux trois horizons, reproductibilité et préfixes, seuils, drawdowns,
comparaisons appariées, absence de fuite du mois testé et sensibilité. Tests de
collecte : mois complets, calendriers US/CAD et FX, absence de prix futur,
sources manquantes et schéma. Tests navigateur : modes, horizons, résultats,
classement global, montants, détails, retour à l’historique et petits écrans.

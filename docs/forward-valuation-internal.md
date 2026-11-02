# Notes de préparation de la valorisation forward

Le module a été intégré à Recherche à la demande de l’utilisateur. La
[documentation courante](forward-valuation.md) décrit la publication et le refresh.
Les notes ci-dessous décrivent la préparation et les vérifications initiales.


Travail local demandé le 2 novembre 2026. Aucun push, déploiement, workflow ou
planificateur de collecte n'est déclenché par cette fonctionnalité.

Recherche → Valorisation forward (`#view=recherche&tab=forward`) présente les
quatre multiples P/E FY1, P/E FY2, EV/EBITDA FY1 et EV/EBITDA FY2. Le sélecteur
d'horizon choisit les deux graphiques superposés. Le contrôle d'historique
(1 an, 2 ans, 5 ans, Maximum) est indépendant du choix FY1/FY2.

FY1 et FY2 désignent les deux premiers exercices dont la fin reste future à
chaque observation. Les calendriers de NVDA, MDA, MU, AAPL et RY sont vérifiés ;
les autres dates restent des repères fournisseur, parfois approximatifs. Ce choix, autorisé par
l'utilisateur, ne prétend pas reproduire des horizons glissants Bloomberg.
Aucun RSI n'est affiché. POW reste exclu, conformément au périmètre antérieur.

La vue **Listes**, affichée par défaut, sépare pour chacun des quatre ratios
les actions strictement au-dessus de la ligne verte (Q3) et celles strictement
sous la ligne rouge (Q1). Chaque action est comparée à son propre historique.
Les listes sont alphabétiques, utilisent la période sélectionnée et indiquent
la couverture, les titres dans la zone centrale et les raisons d'exclusion.
Une absence d'historique EV/EBITDA est présentée comme « Classement
indisponible », jamais comme la preuve qu'aucun titre ne dépasse un quartile.
Cliquer sur un ticker ouvre **Graphiques** avec cette action et cet horizon.
La sélection commune retient les P/E sous Q1 aux deux horizons, avec une même
source et une même date. Une case permet d'exiger aussi les deux Q1 sur cinq
ans. Cela reste une sélection historique, sans validation des fondamentaux.

## Vérification bornée du 2 novembre 2026

La vue **Vérification · 5 titres** isole NVDA, MDA, MU, AAPL et RY. Leurs cours
MarketScreener recoupent à 0,005 unité près les clôtures Yahoo conservées du
30 octobre, dans la même devise. Les prévisions sont des tables observées le
2 novembre, sans date individuelle des révisions d'analystes. Les définitions
comptables BPA/EBITDA ne sont pas certifiées interchangeables entre sources.
Ces relevés restent indicatifs : aucune séance complète du 30 octobre ou du
2 novembre n'est créée et les courbes DoltHub ne sont pas prolongées.

`scripts/forward_fiscal_calendars.py` applique les calendriers publiés :
dernier dimanche de janvier (NVDA), dernier samedi de septembre (AAPL), jeudi
le plus proche du 31 août (MU), 31 décembre (MDA), 31 octobre (RY). Les valeurs
et dates d'origine restent conservées. Au roulement, un FY2 existant peut
devenir FY1 ; une prévision absente reste absente. RY passe à FY2027/FY2028 au
2 novembre. Les variations de prévisions sont comparées par exercice et non
par étiquette FY1/FY2.

L'EV de MDA est suspendue dans les vues d'origine jusqu'au rapprochement du
pont de dette nette annuel avec le bilan plus récent. Un import personnel
explicite de ce même ratio peut toujours fournir sa propre série. RY demeure
N/D pour EV/EBITDA. Les EV de NVDA, MU et AAPL restent indicatives : leur pont
de bilan annuel n'a pas été rapproché du dernier bilan trimestriel.

Les sources, snapshots d'origine, cours datés et calculs sont conservés dans
`data/forward-audit.json`. `scripts/audit_forward_internal.py` reproduit ce
contrôle sans réseau ; `--source-dir` sert à la capture initiale seulement.
Une préparation depuis le classeur conserve la vérification et les suspensions.

L'historique EBITDA forward FY1/FY2 reste manquant. La base DoltHub examinée
ne présente pas de table de prévisions EBITDA, les courbes génériques
MarketScreener n'ont pas d'horizon certifié, et l'offre Bloomberg point-in-time
décrit des droits Enterprise Data/Data License non disponibles ici. Aucune
prévision actuelle n'est appliquée aux anciens cours. Un export autorisé des
deux historiques, avec des dates et définitions stables, peut alimenter
l'import CSV existant.

## Refresh privé

Le refresh des multiples récents est pris en charge par la tâche existante du
briefing du matin, comme solution de repli à un ordonnanceur privé. Voir
`docs/forward-refresh.md`. Le runner standard-library
`scripts/refresh_forward_internal.py` réutilise les clôtures publiques SAVY,
actualise les tables de prévisions et conserve les dernières entrées valides
en cas d'échec. Il n'effectue aucune publication. Les cartes de Graphiques
montrent les derniers multiples avec leurs dates ; les classements et les
historiques DoltHub gardent leurs dates d'origine.

L'export HTML embarque le runner, son code et ses dépendances locales dans un
paquet explicite sans positions privées. La prochaine exécution peut repartir
du dernier fichier conservé, sans dépendre du workspace ou du classeur initial.

## Sources et calcul

`scripts/prepare_forward_internal.py` lit sans modifier le classeur
`SAVY_Historique_Forward_PE.xlsx` du 29 octobre 2026 et les archives publiques
`data/valuations/`. Il rapproche chaque P/E numérique au prix/BPA datés et
contrôle l'antériorité du consensus (au maximum sept jours).

Les historiques P/E mensuels DoltHub restent séparés des relevés quotidiens
MarketScreener. Une lacune du dernier FY2 ne devient pas un ancien multiple
« actuel ». Les deux sources ne sont jamais raccordées. Les séries génériques
de `data/valuation-history/` ne sont pas utilisées : leur horizon n'est pas
certifié. Le calcul EV/EBITDA utilise l'EV indicative conservée avec le relevé,
pas une dette future. Les sociétés financières restent N/D pour ce ratio.

Les repères utilisent uniquement les observations positives de la fenêtre
affichée : moyenne arithmétique, médiane, Q1 et Q3 (quantile interpolé de type
7). Le percentile attribue un demi-poids aux égalités. Les bandes exigent 12
relevés mensuels/importés ou 30 relevés quotidiens SAVY. Les cours non confirmés,
les séances incomplètes et les consensus de plus de sept jours n'entrent pas
dans les historiques quotidiens. Le dernier relevé peut rester affiché comme
indicatif avec sa vraie date, sans devenir un point de clôture vérifié.

Limite conservée : les relevés EV/EBITDA FY1/FY2 n'offrent qu'une courte archive,
donc pas de quartiles fiables. L'interface garde leurs multiples disponibles
et explique cette insuffisance. Elle ne reconstitue pas de passé à partir des
estimations actuelles. Un import CSV facultatif, limité à la session navigateur,
permet de fournir de vrais historiques des mêmes horizons. Un import partiel
remplace seulement les métriques effectivement fournies; aucune donnée n'est
envoyée au serveur. Les positions privées et leurs quantités ne sont pas lues.

## Vérification et aperçu

```sh
node --test tests/forward-valuation-utils.test.cjs tests/valuation-utils.test.cjs tests/portal-utils.test.cjs
python -m unittest discover -s tests -p test_forward_audit.py -v
python scripts/audit_forward_internal.py
python scripts/export_forward_preview.py /absolute/path/SAVY_Valorisation_Forward_Interne.html
```

L'export contient les mêmes CSS, calculs, interface et données que l'onglet,
dans un HTML autonome. Il ne nécessite aucun service externe pour les données,
la police ou les graphiques. L'import CSV est explicite et local à la session.

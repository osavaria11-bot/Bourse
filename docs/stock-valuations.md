# Valorisation des actions individuelles

## Vue combinée — 29 octobre 2026

Chaque panneau présente les courbes MarketScreener disponibles et un encadré séparé des multiples actuels SAVY à 12 mois et mois 13–24. Les dates du cours, du consensus et du pont EV sont conservées, ainsi que les indications de conversion et de cotation. Les deux valeurs courantes n'entrent jamais dans les RSI ou statistiques de la série du fournisseur. Les prévisions insuffisantes restent N/D. Les archives SAVY demeurent accessibles; un seul relevé est présenté sans graphique vide, avec un bouton vers les courbes du fournisseur. Cette présentation ne complète pas les archives historiques 12/24 mois manquantes et ne modifie aucun fichier de données.

## Courbes visibles dès l’ouverture — correctif du 28 octobre 2026

Le choix par défaut « Historique estimé · MarketScreener » affiche les séries publiques `P/E (Estimate)` et `EV / EBITDA (Estimate)` du fournisseur, avec leur RSI de Wilder et leurs statistiques. `scripts/collect_valuation_history.py` les conserve séparément dans `data/valuation-history/`, sans modifier `data/valuations/` ni recalculer de consensus passés. L’API publique de graphique emploie `type=PER` et `type=EV_EBITDA`. Les dates retenues sont uniquement celles possédant un cours dans le même graphique; les fins de semaine ajoutées par la série estimée et les dates futures sont exclues. Les valeurs nulles ou non positives restent des interruptions. Le dernier niveau reste N/D si la dernière séance ne possède pas de multiple positif.

**La définition de ces séries ne certifie ni un horizon constant de 12/24 mois ni un consensus historique point-in-time.** Leur EV suit la méthode du fournisseur; elle n’est pas assimilée à l’EV actuelle reconstruite dans SAVY. Les données peuvent être révisées par la source. Elles ne sont jamais raccordées aux multiples SAVY ni présentées comme du Bloomberg 1BF/2BF. Le contrôle 1 an / 2 ans apparaît seulement dans les modes de suivi SAVY. La période « Maximum » affiche exactement toute la série obtenue, et non cinq années promises. Pour NVIDIA, 943 séances du 26 janvier 2023 au 28 octobre 2026 ont été obtenues lors du correctif.

Les modes « Suivi SAVY · 12 / 24 mois » et « Suivi SAVY · FY1 / FY2 » conservent la méthode et l’archive datée décrites ci-dessous. Leur historique demeure court. La collecte quotidienne de consensus effectue aussi la commande suivante depuis l’environnement autorisé, jamais depuis le runner GitHub ayant reçu un refus MarketScreener :

```sh
python scripts/collect_valuation_history.py
python -m unittest discover -s tests -p 'test_valuation*.py'
```

Un refus d’accès arrête les demandes pour le titre, sans client alternatif ni contournement. La dernière série valide garde ses dates et son statut. Seul le catalogue public est lu; aucun profil privé n’est requis.

La vue Recherche → Valorisation présente deux panneaux superposés : P/E forward et EV/EBITDA forward. Chacun contient le multiple et un sous-panneau RSI de ce même multiple. Les FNB sont exclus de `data/valuation-universe.json`.

## Méthode et limites de source

Les sources consultées le 28 octobre 2026 sont les pages publiques de valorisation MarketScreener, son graphique de référence de cours, la description Bloomberg Company Financials, Estimates and Pricing Point-in-Time, le guide Bloomberg RMB Equity Solutions (études techniques), une présentation officielle Celestica décrivant BEst P/E et le guide RSI de Fidelity.

- Bloomberg daté : https://professional.bloomberg.com/products/data/enterprise-catalog/cofi/
- Études Bloomberg : https://assets.bbhub.io/professional/sites/10/RMB-Equity-Solutions.pdf
- Définition BEst décrite par Celestica : https://corporate.celestica.com/static-files/0736afb8-79ee-4dab-947b-9d7231521eb4
- RSI : https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI
- Exemple de source publique : https://www.marketscreener.com/quote/stock/APPLE-INC-4849/valuation/

La construction à horizon constant s'inspire du principe de pondération des consensus annuels, sans revendiquer une équivalence avec les données propriétaires BEst. Le calcul utilise les jours calendaires jusqu'à la fin du mois fiscal; la table source ne donne pas toujours le jour exact des exercices à 52/53 semaines. « 1 an » correspond aux mois 1 à 12 et « 2 ans » aux mois 13 à 24; ce dernier n'est pas un BPA cumulé sur deux années. Deux années de prévisions sont nécessaires pour chaque mélange, donc un horizon 2 ans peut demander la troisième année fiscale. Un exercice manquant reste N/D. L'option FY1/FY2 est une base distincte affichant les deux prochains exercices dont la fin n'est pas passée, avec les dates exactes.

P/E = cours source / consensus de BPA de l'horizon. EV/EBITDA = EV indicative au cours source / consensus EBITDA de l'horizon. Même EV pour les deux horizons : capitalisation du relevé + dernière dette nette annuelle publiée, avec recours au pont EV–capitalisation de la dernière année publiée si la dette nette manque. Ce bilan peut être ancien; intérêts minoritaires, actions privilégiées, acquisitions et mouvements récents de trésorerie peuvent manquer. Les montants sont conservés en millions dans la devise explicite de la table. Les colonnes d'EV future fondées sur une dette projetée ne deviennent jamais l'EV actuelle. Il ne s'agit pas d'un EV Bloomberg au dernier trimestre.

Les clôtures quotidiennes terminées peuvent être reprises de Yahoo Finance sur la cotation canonique, uniquement dans la même devise que le consensus. La capitalisation est recalée proportionnellement au cours, à nombre d’actions implicite du relevé constant; la dette publiée ne change pas. Les cours avant la fin de séance, les fractions non rapprochées, les variations de plus de 35 % et les mauvaises cotations sont refusés. Pour TSM et NVO, les devises de la table sont celles de l’action ordinaire à Taïwan et au Danemark : la valorisation de l’émetteur et la possibilité d’une prime de l’ADR sont explicitement indiquées.

Le rapprochement des cotations vérifie le ticker, le type Stock, la devise demandée dans les résultats publics, l'unicité de la société, la devise et l'échelle de la table, et la cohérence cours/BPA/P/E. Les doubles cotations CLS, SHOP et WCN utilisent la cotation principale indiquée par MarketScreener, sans mélanger son cours avec un BPA d'une autre devise. MSFTCDR et SNDK (CDR) sont des alias explicites de MSFT et SNDKUS : multiples de l'action américaine sous-jacente, pas du reçu canadien.

EV/EBITDA est N/D pour les institutions financières identifiées dans le catalogue. Les dénominateurs non positifs et les consensus absents ne donnent ni zéro ni un multiple positif fabriqué.

## Historique et RSI

**La série historique 1 an / 2 ans de cinq années n'a pas été obtenue.** Les courbes de prix historiques et les tables de consensus actuelles ne permettent pas de la reconstituer fidèlement. Le graphique générique estimé de MarketScreener n'est pas déclaré équivalent à 1BF ou 2BF. Aucun résultat annuel réalisé ni consensus actuel n'est appliqué rétroactivement aux anciens cours.

L'archive commence au premier relevé effectivement observé. `date` est le jour réel de collecte à Toronto et `observed_at` l'instant UTC. `price_date` est rapproché au cours de la série du fournisseur : un ancien cours n'est jamais redaté. Les points incomplets sont conservés pour l'audit mais exclus du RSI et des statistiques de clôture. Un point est déclaré `complete_session` seulement après 17 h à Toronto, en semaine, et avec un cours vérifié du même jour. La source doit effectivement posséder ce cours; les jours fermés ne produisent pas un nouveau point artificiel. Une ancienne observation ne peut pas remplacer une date plus récente. Les consensus des journées précédentes ne sont jamais réécrits avec les estimations d'aujourd'hui. Les collectes du même jour peuvent améliorer le relevé de ce jour.

RSI de Wilder 14 : moyenne simple des gains et pertes sur les 14 premières variations, puis lissage `(précédent*13 + variation)/14`. Calcul sur les variations du multiple, pas du cours. Il faut 15 clôtures de ce même ratio. Les gains seuls donnent 100, les pertes seules 0 et une série constante 50. Un multiple manquant réinitialise le calcul; aucune interpolation. Les dates de séances précédentes de la source permettent aussi de détecter une vraie clôture manquante sans traiter une fin de semaine ou un congé documenté comme une séance manquante. L'initialisation précède le découpage 1/3/5 ans ou Maximum lorsque des données existent.

Les repères historiques demandent 30 observations : médiane, intervalle empirique 10–90 %, percentile du dernier multiple avec demi-poids des égalités, écart relatif à la médiane. Ils portent sur la fenêtre affichée et ne sont pas assimilés au RSI. Les valeurs de RSI ne constituent pas des recommandations automatiques d'achat ou de vente.

Pour disposer immédiatement de cinq années, il faut une source autorisée fournissant des consensus réellement datés pour les mêmes horizons et bases comptables, par exemple un export point-in-time de Bloomberg, FactSet, Capital IQ ou LSEG. Aucun abonnement n'est acheté, aucun compte n'est créé et aucun accès payant n'est contourné par ce collecteur.

## Univers et confidentialité

`data/valuation-universe.json` est un univers public de sociétés disponibles dans le catalogue SAVY et de titres analysés dans les éditions Finviz. Il ne contient aucune composition privée, quantité, coût moyen ou clé d'accès. Le navigateur rapproche localement les trois profils OS/JMC/MCL au moyen de `SavyPortfolioStocks.list()`, qui ne retourne que des tickers. Les profils chiffrés restent déchiffrés dans le composant privé existant. Aucune quantité réelle n'est nécessaire au collecteur.

Le screener conserve toutes ses éditions, pas seulement le Top 5 et pas seulement les titres encore admissibles. Le PDF du 14 octobre documente aussi les membres de l'univers précédent du 7 octobre. À chaque nouvelle édition, conserver les anciennes entrées et ajouter tous les admissibles individuels vérifiés à `research_editions` et au catalogue. Ne jamais ajouter de FNB ni modifier le classement pour ce besoin.

## Mise à jour et vérification

L’automatisation SAVY « Valorisation quotidienne SAVY » renouvelle le consensus chaque jour après clôture, prévue vers 18 h 17 à Toronto. Le premier essai depuis GitHub le 28 octobre 2026 a reçu des réponses HTTP 403 de MarketScreener. Le runner GitHub ne tente plus ces requêtes : `Daily stock valuations` emploie exclusivement `--quotes-only` à 18 h 47 et 21 h 17 en semaine pour les clôtures Yahoo, sans contourner ce refus. L’accès public de l’environnement de recherche a été vérifié lors de la collecte initiale. La tâche de consensus utilise ce même environnement et signale un blocage s’il devient inaccessible. La publication ne modifie que `data/valuations/`, sur le main courant, sans force. Une collision non résoluble laisse l'état antérieur et est reprise à la prochaine exécution. La fin de ce workflow réveille le déploiement Pages. Le composant ouvert vérifie l'index toutes les cinq minutes et au retour sur la page; son cache conserve les vraies dates et affiche une indisponibilité au besoin. Les collectes inaccessibles restent explicitement `cached` ou `unavailable`. Le cours peut être revalorisé avec le dernier consensus connu : `consensus_date` et `consensus_observed_at` conservent alors la date réelle des prévisions, tandis que `date`, `observed_at` et `price_date` identifient la valorisation et le cours. Les numérateurs sont recalés au nouveau cours; les prévisions et le bilan ne sont pas redatés. Les données de consensus de plus de sept jours restent exclues du RSI et des statistiques, même si les cours se renouvellent. Une clôture nouvellement reçue est comptée séparément dans `coverage.quotes_fresh`; un ancien cours dont le précédent statut était fresh ne compte pas comme une nouvelle collecte réussie.

Commandes :

```sh
python scripts/collect_valuations.py
python scripts/collect_valuations.py --check
python -m unittest discover -s tests -p test_valuations.py -v
node --test tests/valuation-utils.test.cjs
node tests/valuation-browser.cjs
```

Les tests utilisent uniquement des positions et consensus synthétiques, y compris pour les trois profils. Ils vérifient les deux horizons, le calcul de l'EV, le RSI du ratio (y compris un cours constant avec révision du consensus), les données manquantes, les dates, la conservation de l'archive et l'absence de FNB. Les régressions navigateur couvrent la navigation, les trois comptes, les CDR, les deux graphiques, les contrôles et la géométrie mobile.

Le test pré/après séance attend désormais le pourcentage calculé après chargement des clôtures : le libellé du profil peut être prêt avant les données asynchrones. Les mêmes valeurs numériques restent exigées.

Quand une action canadienne cote en CAD et publie un BPA/EBITDA en USD, le cours natif est converti à un taux USD/CAD Yahoo daté au plus tard à la même clôture régulière. Les bougies de change sont terminées (timestamp de fin), avec au plus dix minutes d’écart; aucun taux ultérieur n’est admissible. La devise et le cours natifs, le taux et son horodatage sont conservés. Les clôtures anticipées sont celles des métadonnées du fournisseur. Si la clôture native ou le change de cette séance manque, aucune conversion n’est inventée. La collecte de vérification du 28 octobre a confirmé les sept cas ATD, CLS, CSU, DSG, HBM, PRL et VNP avec un change au 28 octobre 20 h UTC (16 h Toronto).

Le scénario pré/après séance dispose aussi de métadonnées de collecte synthétiques cohérentes avec son horloge de prémarché; un fichier réel téléchargé plus tard dans la journée ne peut sinon passer la protection de données futures, qui reste intacte en production.

La tâche de consensus utilise explicitement `--consensus-only` : aucune requête Yahoo n’est émise depuis cet environnement. Une clôture du même jour, de la même cotation et de la même devise déjà vérifiée peut être réutilisée avec les nouveaux consensus. Le workflow GitHub utilise `--quotes-only`, sans requête MarketScreener. Cette séparation respecte les accès disponibles et conserve la provenance de chaque entrée.

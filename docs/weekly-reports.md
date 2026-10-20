# Rapports hebdomadaires sur SAVY

La section `#weeklyReports`, en bas de `index.html`, lit `data/weekly-reports.json`.
Elle présente indépendamment le dernier débriefing immobilier et le dernier
classement Finviz, puis un lien ouvrant chaque document PDF dans un nouvel onglet.

## Recherche et suivi coordonnés

La tâche hebdomadaire existante réunit **deux volets dans une seule livraison le
mercredi à 22 h, heure de Toronto** (`America/Toronto`, avec changement d’heure) :
recherche Finviz et suivi des portefeuilles simulés A / B / SPY. L’ancien affichage
« mercredi 22 h UTC / jeudi 16 h 30 » est remplacé. Aucune nouvelle tâche n’est
créée. Le jeudi reste la règle de clôture d’exécution des instructions simulées,
avec report à la première séance ouverte suivante si nécessaire; ce n’est pas
une seconde livraison. Le rapport du mercredi valorise la dernière séance
terminée et distingue transactions admissibles déjà exécutées et ajustements
en attente. Il ne comptabilise pas la clôture du jeudi à l’avance.

Le même PDF complet contient la recherche et le tableau de suivi A / B / SPY.
Pour rendre les deux volets visibles sur SAVY avec le schéma existant, réserver
trois éléments de `reports.stocks.highlights` au suivi : A « Top 5 pondéré »,
B « Autres équipondérés » et SPY. Chaque élément indique la date de valorisation,
la valeur en USD, le rendement de la période et depuis le lancement et, pour A/B,
l’écart à SPY en points de pourcentage sur la même période. Préciser la période
et le traitement des dividendes dans `summary` ou `method_note`. Les chiffres
viennent de l’état et du classeur de simulation courants; les valeurs d’un ancien
exemple ne sont pas des données actuelles. Si le suivi est indisponible, l’indiquer
explicitement avec N/D et conserver son état, sans inventer de performance.
Ne publier aucun état privé, identifiant de fichier, quantité personnelle ni clé.

**Séparation demandée le 20 octobre 2026 : ne pas inclure la recherche ni le
suivi A/B/SPY dans le briefing du matin, ni à l’écrit ni en audio.** Ils restent
dans Recherche & suivi et dans leur PDF. Cette consigne remplace la reprise du
jeudi envisagée le 19 octobre. Le briefing reste consacré aux nouvelles de marché;
il ne doit ni reprendre le rapport interne ni annoncer son retard.

Le producteur hebdomadaire préserve les changements concurrents sur `main`, les
autres rapports et les historiques. Les collectes macro/cotations ne créent ni
rapport Finviz ni performance simulée.

## Chiffres et continuité dans Recherche

`data/research-performance.json` est la projection publique des seules valeurs
de A, B et SPY de l’état de simulation existant. Il ne contient aucune position
personnelle, quantité, transaction détaillée ou identité de fichier privé.
Le tableau indique sa propre clôture réelle et ses dates de période : il peut
être plus récent que le PDF de recherche sans modifier cette édition archivée.
La première projection reprend les douze valorisations déjà enregistrées du
30 septembre au 15 octobre 2026; elle ne crée pas de cours pour les séances suivantes.

À chaque livraison hebdomadaire, lire l’état et le classeur courants, traiter
les seules instructions admissibles puis exécuter :

```bash
node scripts/build_research_performance.cjs /chemin/absolu/etat-courant.json
node scripts/validate_weekly_reports.cjs
```

Le générateur vérifie les NAV contre les positions et liquidités de clôture,
les montants des transactions, leur antériorité de publication, les rendements
journaliers/cumulés et ceux de la fenêtre enregistrée ainsi que les écarts à SPY.
Il compare la projection avec l’historique public existant et refuse toute
réinitialisation ou réécriture. Publier cette projection, le registre et le PDF
de la nouvelle édition ensemble. Ne jamais publier le fichier d’état source.
Si une clôture ou un contrôle manque, conserver le dernier relevé avec sa date;
ne pas combler avec zéro ou appeler une ancienne clôture celle du jour.

Le navigateur recalcule les rendements depuis les NAV, sans ajouter des
pourcentages. Cumul = dernière valeur / 10 000 − 1; période = dernière valeur /
valeur au début de période − 1; écart à SPY = différence des rendements aux mêmes
dates, en points de pourcentage. La base historique reste **USD hors dividendes**,
sans frais ni fiscalité : un dividende à recevoir ne s’ajoute pas à cette série.
Le lecteur conserve le dernier relevé validé en cas de panne ou d’historique
incompatible et ne présente pas les résultats du backtest FNB comme ceux de Finviz.

## Publier une nouvelle édition

1. Produire le rapport de recherche et son PDF final, avec ses sources et sa date.
2. Ajouter le PDF public à `reports/real-estate/YYYY-MM-DD.pdf` ou
   `reports/stocks/YYYY-MM-DD.pdf`. Conserver les éditions précédentes.
3. Lire la dernière version de `data/weekly-reports.json` depuis `main`.
   Remplacer seulement `reports.real_estate` ou `reports.stocks`, selon le rapport
   produit, et actualiser `generated_at` en UTC. Préserver l’autre rapport.
4. Pour chaque édition, conserver `title`, `edition_date`, `summary`,
   `document_scope` (`full` ou `summary`), `highlights` (0 à 6 éléments) et
   `document` : `path`, `label`, `mime_type: application/pdf`, `pages`, `size_bytes`
   et `sha256` calculés sur les vrais octets du PDF final.
5. L’immobilier accepte jusqu’à trois `opportunities` avec `address`, `city` et
   `detail`. Ne pas présenter une annonce comme une vente conclue. Conserver
   la date réelle de vérification et le statut des prix/RNE dans le rapport.
6. Les actions exigent `reference_date`, `method_note` et `stocks` : rangs
   consécutifs à partir de 1, `ticker`, `company`, `rating` numérique sur 5
   (ou `null`), `decision` (`BUY`, `HOLD`, `SELL` ou `null`), `summary`,
   `central_label` et `risk`. Au plus cinq titres, jamais de remplissage si
   moins de cinq sont admissibles. Les décisions et projections restent datées;
   ce ne sont pas des cours en direct. Distinguer USD/CAD, horizon et dividendes.
7. Exécuter `node scripts/validate_weekly_reports.cjs`, `npm test` et les tests
   navigateur. Publier le PDF et le registre ensemble dans un commit GitHub.
   Attendre la réussite du déploiement Pages puis vérifier l’ouverture des PDF.

Les tâches ChatGPT existantes restent responsables de la recherche et de la
rédaction. Les workflows de cotations ou de collecte macro ne fabriquent ni
classements ni analyses immobilières et n’altèrent pas ce registre. L’interface
conserve les dernières éditions validées lorsqu’un chargement échoue ou qu’une
édition reçue est plus ancienne. Les PDF sont des fichiers statiques du site,
sans URL temporaire ni accès à un espace de fichiers authentifié.

## Éditions initiales

- Immobilier du 12 octobre 2026 : synthèse des éléments retrouvés du brief,
  identifiée comme telle, car aucun document joint original n’a été retrouvé.
- Finviz du 14 octobre 2026 : copie inchangée du dernier PDF existant,
  16 pages. Quatre titres admissibles : MA, LLY, APH et WMG. Les treize filtres de
  cette édition ne sont pas remplacés rétrospectivement par les douze filtres
  demandés le 17 octobre, qui s’appliquent aux prochaines éditions.

Ne publier aucune clé personnelle, sauvegarde de positions réelles, identifiant
de fichier privé ou autre renseignement personnel dans les rapports publics.

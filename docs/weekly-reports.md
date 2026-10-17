# Rapports hebdomadaires sur SAVY

La section `#weeklyReports`, en bas de `index.html`, lit `data/weekly-reports.json`.
Elle présente indépendamment le dernier débriefing immobilier et le dernier
classement Finviz, puis un lien ouvrant chaque document PDF dans un nouvel onglet.

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

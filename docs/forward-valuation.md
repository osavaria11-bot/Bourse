# Valorisation forward — Recherche

Recherche → Recherche & suivi / Archives / **Valorisation forward**.
Le nouvel onglet est le dernier à droite, avec le lien direct
`#view=recherche&tab=forward`. Il est intégré au portail, sans iframe. Les cartes et graphiques suivent les
trois palettes SAVY ; Q1 reste rouge et Q3 vert.

## Multiples et historique

Quatre multiples indépendants : P/E FY1, P/E FY2, EV/EBITDA FY1 et EV/EBITDA
FY2. FY1/FY2 désignent les deux premiers exercices dont la fin reste à venir,
et non des périodes glissantes de 12/24 mois. Cinq calendriers fiscaux sont
vérifiés (NVDA, MDA, MU, AAPL et RY) ; les autres dates restent celles des
fournisseurs et peuvent désigner une fin de mois approximative. POW est exclu.

Les graphiques affichent moyenne, médiane, Q1 (25 %) et Q3 (75 %), avec
interpolation linéaire. Fenêtres 1/2/5 ans et Max indépendantes de FY1/FY2.
Les listes comparent chaque titre à ses propres quartiles. Cliquer sur un
ticker ouvre son graphique ; une sélection commune retient les deux P/E sous
Q1, avec confirmation facultative sur cinq ans. Ce classement historique
n'est pas une recommandation automatique d'achat ou de vente.

Les séries mensuelles DoltHub ne sont pas raccordées aux relevés récents
MarketScreener. Les observations datées des 28–29 octobre restent archivées,
avec leurs dates explicites. Les prévisions actuelles ne sont jamais
appliquées rétrospectivement à d'anciens cours. Les observations matinales sont
archivées séparément ; elles ne sont pas attribuées à la clôture de la veille.
EV MDA reste suspendue jusqu'au rapprochement du bilan, EV des financières
N/D et les autres EV indicatives. L'historique initial EBITDA FY1/FY2 reste
manquant : quartiles et classements indisponibles tant qu'une source datée,
comparable et autorisée n'est pas fournie. Import CSV local disponible.

## Actualisation

`data/forward-valuation.json` contient les archives, les multiples récents,
leurs sources et le statut de la dernière collecte. La tâche existante du
briefing du matin exécute le runner puis publie ce seul JSON supplémentaire
avec ses changements autorisés, sans introduire les valorisations dans les
nouvelles ou l'audio. Il n'est plus nécessaire de remplacer un HTML privé.

```sh
python scripts/refresh_forward_internal.py --data-only --prices data/security-prices.json
```

Le runner réutilise les clôtures déjà collectées par SAVY. Python standard et
Node suffisent. Quatre requêtes simultanées maximum, délai réseau 25 secondes,
aucune nouvelle requête après un budget de trois minutes. Un deuxième passage
le même jour réutilise les prévisions déjà relevées. Refus HTTP 401/403/429 ou
vérification humaine : suspendre la source, conserver les derniers relevés
valides et leur vraie date, sans contournement. Les devises, cotations, cours
absents, splits possibles et prévisions de plus de sept jours restent signalés.

Le runner valide le JSON avec le même validateur que l'UI avant de le
remplacer. Les erreurs sont séparées par titre. Une ancienne valeur ne reçoit
jamais une nouvelle date de cours ou de consensus par simple échec de collecte.

Les données ne sont chargées qu'à la première ouverture de l'onglet. La vue
visible vérifie les mises à jour toutes les cinq minutes, lors du retour au
premier plan et à la réouverture de l'onglet. Les choix d'action, de période,
d'horizon et les imports de la session sont conservés. Aucun accès aux
positions privées, quantités ou prix de revient n'est nécessaire.

## Contrôles

```sh
node --test tests/forward-valuation-utils.test.cjs tests/valuation-utils.test.cjs tests/portal-utils.test.cjs
python -m unittest discover -s tests -p 'test_forward_*.py' -v
```

`data/forward-audit.json` et `scripts/audit_forward_internal.py` conservent la
vérification reproductible initiale des cinq titres du 2 novembre 2026.

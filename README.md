# SAVY — Tableau macroéconomique

Un tableau de bord en français pour suivre le cycle économique aux États-Unis et au Canada, à partir des observations publiées sur **FRED** et par la **Banque du Canada**.

## Fonctions

- **34 indicateurs** : taux, inflation, emploi, activité, crédit, marchés, immobilier, Canada et matières premières.
- **Graphiques interactifs** avec périodes de 1 mois, 3 mois, 1 an, 5 ans et 10 ans; valeurs au survol et navigation avec les flèches du clavier.
- **Vue détaillée** : explication de l’indicateur, dernières observations, lien vers la source et export de l’historique.
- **Recherche**, filtres par catégorie, tri par nom ou date, et **favoris** conservés dans le navigateur.
- **Export CSV** de la sélection, compatible avec Excel et protégé contre les formules dans les champs texte.
- **Modes clair et sombre**, disposition adaptée au téléphone et dialogues accessibles au clavier.
- **Nouvelles sélectionnées pour leur effet sur les marchés** : 1 à 6 sujets récents en français, chacun avec sa publication datée, son lien et la raison de le surveiller. Sous le briefing, 3 à 4 points expliquent les graphiques FRED à surveiller avec leur vraie période d’observation. Aucun quota de mots.
- **USD/CAD de marché** : cours médian indicatif de biquote demandé au navigateur chaque minute, avec heure et statut du marché; les graphiques et variations historiques du portefeuille restent calculés sur des clôtures quotidiennes Yahoo Finance.
- **Décisions Fed et Banque du Canada** : fourchette cible américaine officielle et probabilités de hausse, maintien ou baisse à la prochaine réunion, issues des swaps SOFR/CORRA selon BlueGamma et affichées avec leur date.
- **Six graphiques de marchés mondiaux** : S&P 500, Nasdaq Composite, S&P/TSX Composite, STOXX Europe 600, FNB EEM suivant le MSCI Emerging Markets et FEQT (Fidelity All-in-One Equity) en CAD. Clôtures quotidiennes, périodes de 1 jour à 10 ans incluant YTD, rendements en % et sources accessibles.
- **Portefeuille privé** : quantités conservées dans le navigateur, valorisation en CAD, prix moyens, gains latents, pondérations et variations par titre, import/export JSON et graphique YTD, 6 mois, 3 mois, 1 mois, 1 semaine et 3 jours.
- **Vue compacte du portefeuille** : positions repliées par défaut, choix mémorisé sur l’appareil, et tri croissant/décroissant des gains latents en % et en CAD ainsi que des variations en CAD.
- **Point quotidien des positions** : les trois meilleures et les trois moins bonnes performances en %, en CAD avec le change, actualisées avec les cours. Les boutons YTD, 6 mois, 3 mois, 1 mois, 1 semaine et 3 jours permettent de choisir la période du classement; un mois glissant reste sélectionné par défaut. Le survol du graphique affiche date, montant et % depuis le début de la période affichée.
- Arbres de décision NFCI et TEV/EBITDA et ressources complémentaires conservés.

Les périodes de graphique se terminent à la dernière observation de chaque série. Une flèche indique le sens de variation depuis l’observation précédente, dont la date est disponible au survol. Les périodes mensuelles et trimestrielles sont affichées comme telles.

## Mise à jour et fiabilité

GitHub Actions collecte les observations FRED, les taux directeurs, les probabilités des prochaines réunions, les cours des cinq marchés et ceux du catalogue public de 102 titres avec le taux USD/CAD quotidien **à 6 h 47 chaque jour**, puis à **13 h 17 et 19 h 17 du lundi au vendredi**, à l’heure de Montréal. Le navigateur demande séparément la cotation de change indicative à biquote à l’ouverture et chaque minute tant que l’onglet est visible. Les horaires suivent les changements d’heure; GitHub peut retarder une exécution en cas de charge.

Le **briefing d’actualité** est préparé et publié par la tâche ChatGPT quotidienne à **7 h, heure de Montréal**. Elle choisit les 1 à 6 développements les plus récents et importants pour les marchés, d’après les articles consultés de **Reuters, Financial Times, Wall Street Journal, New York Times et Bloomberg**, d’autres sources fiables et les publications officielles. Elle privilégie les dernières 24 heures, ou les 72 dernières heures en fin de semaine. Elle explique l’effet possible sur les taux, les bénéfices, les devises ou le portefeuille. Les faits, prévisions et interprétations restent distincts; la date de chaque source est visible. La longueur suit l’actualité, sans quota de 500 mots. En l’absence de nouvelle importante, elle publie moins d’articles et date les développements encore pertinents, sans remplir artificiellement le briefing.

La tâche de rédaction actualise `data/daily-briefing.json` dans ce dépôt, y compris les 3 à 4 explications `fred_watch` (série, observation, explication et lien FRED). Les commentaires sont datés de leur observation et revus à chaque édition, sans transformer la date de collecte en date économique. La collecte des observations ne modifie jamais ce fichier. La date d’édition des nouvelles est indépendante de celle des graphiques. En cas de panne, le navigateur peut conserver la dernière édition vérifiée, avec sa date et un avertissement visible. Si la préparation quotidienne échoue, l’édition précédente reste affichée et n’est pas présentée comme nouvelle.

Les observations suivent le calendrier de leurs sources. Par exemple, une statistique mensuelle conserve sa période de référence entre deux publications; la date de collecte ne devient jamais sa date d’observation.

- Les CSV sont lus directement sur FRED par le collecteur Python, avec délais limites et nouvelles tentatives bornées. La fourchette cible Fed utilise `DFEDTARL` et `DFEDTARU`, distinctes du taux effectif `DFF`. Le taux directeur canadien est collecté auprès de la Banque du Canada via son API Valet, série `V39079`. Les cotes BlueGamma sont collectées séparément et masquées si leur observation date de plus de cinq jours ou si la réunion est passée.
- Les quatre indices et les FNB EEM et FEQT sont collectés sur Yahoo Finance. EEM est affiché en dollars US, FEQT en dollars canadiens avec sa cotation `FEQT.NE`, et les indices en points. Les graphiques montrent les cours de clôture, hors dividendes, et ne mélangent pas leurs échelles. Chaque source est vérifiée avec son symbole et la date de séance de sa place boursière; une séance en cours est exclue. La devise CAD de FEQT est également vérifiée. FEQT utilise les mêmes périodes et rendements que les indices; une période antérieure à son historique disponible affiche « Rendement indisponible ».
- Les indices proposent 1 jour (1 séance), 3 jours (3 séances), 1 semaine (5 séances), 1 mois, 3 mois, YTD, 1 an, 5 ans et 10 ans. Le rendement affiché et l’infobulle utilisent la même clôture de départ que le graphique : `(dernière clôture / clôture de départ - 1) × 100`, en devise locale et hors dividendes. YTD utilise la dernière clôture de l’année précédente. Pour les mois et années, une date de départ sans séance utilise la clôture précédente. La collecte conserve 11 ans pour couvrir cette base sur 10 ans; une base absente, manquante ou vieille de plus de 7 jours produit « Rendement indisponible ».
- Chaque série dispose de son propre repli : une panne conserve sa dernière observation valide et son horodatage, tout en actualisant les autres séries.
- Les données manquantes restent des trous dans les graphiques.
- Les fichiers JSON sont remplacés de façon atomique. Si toutes les sources échouent sans valeur valide conservée, les fichiers existants restent en place et le workflow échoue.
- Le navigateur charge les fichiers du site et conserve une copie locale, signalée si elle est utilisée.
- Après une collecte, le déploiement Pages est déclenché par `workflow_run`, car un commit effectué avec `GITHUB_TOKEN` ne déclenche pas un autre workflow `push`.
- Les tests doivent réussir avant le déploiement; celui-ci utilise le commit exact qui a été testé.

## Portefeuille privé

Ouvrir **Mon portefeuille**, puis importer le fichier JSON personnel ou ajouter les positions. Les quantités peuvent être modifiées dans la table. Elles sont enregistrées uniquement dans `localStorage` sur cet appareil; le dépôt public et les collecteurs ne contiennent aucune quantité personnelle. Le lien personnel d’import utilise un fragment d’URL, non envoyé au serveur, et retire les quantités de l’adresse après import. L’export JSON permet de retrouver ses positions sur un autre appareil.

Les titres CAD gardent leur cotation canadienne, notamment Shopify. Celestica garde sa cotation US. Le Sandisk CDR couvert en CAD utilise `SNDK.TO`, distinct de l’action américaine, et sa valorisation ne reçoit pas de conversion USD/CAD supplémentaire. Son historique disponible commence en mai 2026 : une reconstitution incluant ce CDR signale les bases manquantes pour YTD et six mois. L’action Sandisk américaine est identifiée séparément par `SNDKUS` dans le catalogue, avec le symbole source `SNDK` et la devise USD; elle utilise le taux USD/CAD pour la valorisation en CAD. Les ETF Fidelity FEQT et Maritime Launch MAXQ utilisent Cboe Canada (`.NE`). Les clôtures et observations quotidiennes USD/CAD sont vérifiées par symbole et devise. Une cotation plus ancienne est affichée avec sa vraie date; elle peut être reprise pendant au plus sept jours. Les cotations manquantes et le change indisponible rendent la valeur partielle et bloquent la variation totale. Les quotes FX du week-end sont exclues des observations quotidiennes.

Les prix moyens d’achat sont également privés, modifiables et exportés. Le gain latent de chaque titre est calculé dans sa devise d’achat. Le coût global et le gain latent en CAD utilisent le taux USD/CAD actuel; ils excluent l’effet du change depuis les achats, dont les dates et taux ne sont pas connus.

La liste des positions est repliée par défaut. **Afficher mes positions / Masquer mes positions** conserve le choix d’affichage sur l’appareil. Les en-têtes **Gain latent %**, **Gain latent CAD** et **Variation CAD** sont cliquables : premier clic du plus élevé au plus faible, deuxième clic dans le sens inverse. Les montants manquants restent en bas de la liste dans les deux sens. La colonne en dollars convertit les gains de tous les titres en CAD au taux actuel pour rendre le tri comparable; le pourcentage latent compare le cours au prix moyen dans la devise du titre.

Le **point quotidien** classe uniquement les positions présentes dans le navigateur. Il dispose de ses propres boutons **YTD, 6 mois, 3 mois, 1 mois, 1 semaine et 3 jours**, indépendants du graphique. Un mois glissant est sélectionné par défaut. Les périodes mensuelles comparent la dernière clôture à celle disponible au plus tard à la date de référence, avec un ajustement à la fin du mois et la limite de reprise de sept jours. YTD utilise la dernière clôture de l’année précédente; une semaine et trois jours couvrent cinq et trois séances des titres détenus, sans compter les dates de change seules. Le rendement de cours en CAD inclut l’évolution USD/CAD sur la période choisie pour les titres américains, sans dividendes. Il est indépendant des quantités, du coût d’achat et de la période du graphique. Les données manquantes excluent le titre du classement et sont signalées. Les deux listes comportent au maximum trois titres distincts chacune; avec moins de six titres comparables, la seconde liste est plus courte. Le classement se recalcule à chaque collecte de cours publiée et lors des changements de positions, sans enregistrer la composition personnelle dans le dépôt ni créer de tâche supplémentaire.

Le survol et les flèches du clavier donnent la date, la valorisation en CAD et le pourcentage depuis le premier point de la période sélectionnée. Une base de comparaison manquante laisse la variation indisponible, même si une partie de la courbe peut être affichée.

Le graphique compare désormais le portefeuille à **FEQT**, coté en CAD sur Cboe Canada (`FEQT.NE`). Les deux courbes affichent le rendement de cours depuis la même date et la même base, hors dividendes; la légende et le survol montrent les deux rendements et leur écart en points de pourcentage. Le portefeuille conserve le change historique. Une base FEQT manquante ne raccourcit pas silencieusement la période; la comparaison devient indisponible.

La section **Contribution à la performance** suit la période du graphique. Pour chaque position, elle calcule `(valeur finale en CAD − valeur initiale en CAD) / valeur totale initiale × 100`, avec les quantités actuelles constantes et le change historique. Le tableau donne le poids au départ, le rendement du titre en CAD, la variation en dollars et la contribution en points de pourcentage. Les contributions non arrondies s’additionnent au rendement du graphique; une valeur de départ ou de fin incomplète bloque l’attribution entière, sans retirer le titre du dénominateur.

La section **Risque comparé à FEQT** utilise les clôtures exactes communes aux titres détenus, à FEQT et au change historique lorsqu’il est nécessaire. Elle ne fabrique pas de rendements nuls à partir de cours repris pendant un congé. Les dates réelles et le nombre de rendements sont affichés. La volatilité annualisée utilise l’écart-type d’échantillon des rendements de séances communes multiplié par √252, avec au moins 20 rendements; le bêta relatif à FEQT est covariance / variance du benchmark, avec au moins 30 rendements et une variance de référence non nulle. La baisse maximale est le pire recul d’un sommet antérieur à un creux dans la fenêtre observée, avec les dates pour les deux séries. Des trous de plus de sept jours ou une couverture commune inférieure à 80 % rendent le risque indisponible. Ces mesures décrivent la reconstitution hors dividendes, pas l’historique transactionnel du compte.

La section **Résultats trimestriels** remplace les actualités des positions par un calendrier visuel de la semaine, filtré dans le navigateur sur les titres détenus. Le sélecteur permet de consulter les douze semaines précédentes et les cinq suivantes. Les résultats affichent séparément le BPA et les revenus publiés, le consensus et la surprise; les montants et attentes viennent du même fournisseur et de la même devise. Une perte moindre que prévu compte comme une surprise positive; une attente nulle ne donne pas un pourcentage infini. Aucune valeur manquante n’est extrapolée et aucun résultat futur n’est présenté comme publié. Les calendriers Yahoo Finance et les tableaux MarketBeat sont collectés pour l’ensemble du catalogue public, sans lire le portefeuille chiffré. Les doubles cotations et le CDR Sandisk utilisent les résultats de l’entreprise sous-jacente dans leur devise indiquée. Les FNB restent explicitement hors du calendrier d’entreprise. Les messages français relus sont enregistrés dans `data/earnings-highlights.json` et liés à une entreprise, une date et un compte rendu précis; ils ne sont jamais repris pour un trimestre suivant. À défaut, les thèmes courts du compte rendu sont cités dans leur langue originale (au plus 24 mots par compte rendu) ou une comparaison des revenus au même trimestre précédent est affichée et identifiée comme calculée. Les sources et les dates estimées sont visibles. **Image de la semaine** enregistre un PNG local des résultats filtrés, des surprises et des messages, sans quantités personnelles. Les erreurs conservent les données et leur date originale; un calendrier indisponible n’est jamais présenté comme une semaine sans résultat. Le collecteur `scripts/collect_portfolio_earnings.py` rejoint les trois actualisations déjà planifiées et écrit `data/portfolio-earnings.json`.

Les boutons **Secteurs** et **Géographie**, à côté des positions, ouvrent deux tableaux : poids du portefeuille, poids de FEQT et écart en points de pourcentage. Les poids utilisent les valeurs actuelles des titres en CAD, avec le taux USD/CAD courant. Les FNB sont décomposés selon leurs placements sous-jacents. Vanguard fournit les secteurs GICS des titres, ce qui permet d’harmoniser ses FNB avec Fidelity et BlackRock; les obligations restent une catégorie distincte. Les dates et sources de chaque répartition sont affichées. Les pays correspondent aux pays de risque publiés par l’émetteur, et non à la devise, au lieu de cotation ou à la répartition du chiffre d’affaires. Les pays que Fidelity ne détaille pas restent regroupés : une absence n’est pas interprétée comme une exposition nulle. Les répartitions incomplètes restent dans le dénominateur et aucun écart exact n’est inventé. Les quantités personnelles sont calculées uniquement dans le navigateur.

`scripts/collect_portfolio_exposures.py` vérifie les sources Fidelity, BlackRock, Vanguard et QQQM tous les sept jours dans la collecte existante, conserve les dates réellement publiées et garde la dernière répartition datée en cas de panne. QQC utilise sa dernière part QQQM publiée par CI et les dernières positions QQQM; les dates distinctes et la comparaison indicative sont signalées. Les sources statiques et les classifications manquantes sont identifiées dans le fichier public, qui ne contient aucune quantité personnelle.

L’historique est une **reconstitution avec les quantités actuelles constantes**, cours de clôture hors dividendes et taux USD/CAD disponible à chaque date. Il ne reproduit pas les dépôts, retraits, achats, ventes, espèces ou frais du compte. Un historique réel exige les transactions et mouvements d’argent. YTD compare la dernière date à la dernière clôture de l’année précédente; les périodes de six, trois et un mois partent de la dernière séance disponible à la date de référence; une semaine et trois jours correspondent à cinq et trois séances. Une base de comparaison manquante n’est jamais remplacée par un rendement fictif.


Le **lien personnel** ouvre automatiquement un portefeuille intégré, sans fichier à télécharger ou importer. Les positions intégrées sont publiées uniquement sous forme chiffrée (AES-GCM); la clé reste dans le fragment du lien et sur l’appareil. Le manifeste généré dans le navigateur garde ce lien comme adresse de démarrage pour un nouveau raccourci d’écran d’accueil. Les simples actualisations et réouvertures conservent les modifications locales. Une nouvelle révision authentifiée des positions intégrées remplace la base précédente; une panne ou un lien invalide conserve les positions existantes. Sans lien personnel ni positions enregistrées, le site reste vide.

Pour mettre à jour la base intégrée, exécuter `node scripts/seal_personal_portfolio.cjs PRIVATE_INPUT data/personal-portfolio.json` avec la sauvegarde privée placée hors du dépôt. Le script conserve le lien dans le champ privé `savy_access`, réutilise sa clé, change le nonce et la révision, puis écrit uniquement le profil chiffré dans le dépôt. La sauvegarde et son lien restent hors du dépôt et des journaux publics.

## Indicateurs et transformations

La configuration se trouve dans `data/series.json`. Les fichiers publiés sont :

- `data/macro-data.json` : valeurs, dates, variation, statut de collecte et historiques.
- `data/daily-briefing.json` : édition d’actualité en français, sujets choisis, publications citées et 3 à 4 graphiques FRED commentés (schéma 4).
- `data/rate-odds.json` : probabilités Fed/Canada et dates source (schéma 1).
- `data/market-indices.json` : historiques de clôture, dates et statut de collecte des quatre indices et des FNB EEM et FEQT (schéma 2, `kind: market_indices`).
- `data/securities.json` : catalogue public de 102 cotations, sans quantités personnelles.
- `data/security-prices.json` : historiques des titres et USD/CAD, symboles et devises vérifiés (schéma 2, `kind: security_prices`).
- `data/portfolio-exposures.json` : secteurs et pays des 102 instruments du catalogue, répartitions sous-jacentes des FNB, sources et dates (schéma 1, `kind: portfolio_exposures`).
- `data/macro-briefing.json` : instantané statistique de secours généré avec les observations (schéma 2).

Avant de publier une nouvelle édition :

```bash
python3 scripts/validate_news_briefing.py
```

Le validateur vérifie les liens HTTPS, les dates, le nombre raisonnable de sujets et la concision. Le déploiement Pages exécute cette vérification avant publication.

Les nouvelles mesures sont calculées à partir des niveaux publiés :

| Indicateur | Calcul |
|---|---|
| Inflation CPI, CPI sous-jacent et PCE sous-jacent | (niveau / niveau du même mois un an plus tôt − 1) × 100 |
| Croissance du PIB réel | [(niveau / niveau du trimestre précédent)^4 − 1] × 100 |
| Créations nettes d’emplois non agricoles | niveau du mois − niveau du mois précédent, en milliers |

Les calculs associent les périodes par date. Un mois ou trimestre manquant n’est pas remplacé par une autre période.

Les libellés suivants ont été corrigés d’après les fiches officielles :

- [DEXCAUS](https://fred.stlouisfed.org/series/DEXCAUS) est exprimé en dollars canadiens pour un dollar américain : **USD/CAD**.
- [A072RC1Q156SBEA](https://fred.stlouisfed.org/series/A072RC1Q156SBEA) est le **taux d’épargne personnelle**.
- [NASDAQXAU](https://fred.stlouisfed.org/series/NASDAQXAU) est l’indice **PHLX Gold/Silver Sector**.
- [MEDCPIM158SFRBCLE](https://fred.stlouisfed.org/series/MEDCPIM158SFRBCLE) est une variation mensuelle **annualisée**.
- [V39079](https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/) est le **taux directeur canadien** officiel. Il est distinct de la moyenne du taux interbancaire à trois mois.
- [DFEDTARL](https://fred.stlouisfed.org/series/DFEDTARL) et [DFEDTARU](https://fred.stlouisfed.org/series/DFEDTARU) forment la **fourchette cible officielle de la Fed**.
- [IR3TIB01CAM156N](https://fred.stlouisfed.org/series/IR3TIB01CAM156N) est une moyenne mensuelle du **taux interbancaire canadien à 3 mois**.

## Lancer le site

Depuis la racine du dépôt :

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Ouvrir ensuite **http://localhost:8000**. La première collecte peut être lancée depuis l’onglet Actions → Daily briefing → Run workflow, ou localement :

```bash
python3 scripts/generate_daily_briefing.py
python3 scripts/collect_market_indices.py
python3 scripts/collect_security_prices.py
```

Le site utilise du HTML, CSS, JavaScript et SVG, sans dépendance de production à un CDN. Le collecteur utilise la bibliothèque standard de Python.

## Vérifier les changements

Python 3.12+ et Node 22+ :

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

Les tests de navigateur utilisent des positions synthétiques et les historiques publics, ainsi que des données macro synthétiques en mémoire; celles-ci ne sont jamais enregistrées dans les fichiers du site. Ils couvrent recherche, catégories, favoris, thèmes, graphiques, clavier, téléchargements CSV, affichage à 320/375 pixels et repli hors connexion. Ils vérifient aussi les six périodes du portefeuille, la conversion CAD, les quantités fractionnaires, les cotations SHOP en CAD et CLS en USD, le repli persistant des positions, les classements sur les six périodes et leurs boutons indépendants, les tris des gains dans les deux sens, les valeurs et pourcentages au survol, les imports/exports et la protection en cas de change manquant.

Les branches `codex/**` vérifient également les exports réels FRED dans un répertoire temporaire. Les workflows sont dans `.github/workflows/`.


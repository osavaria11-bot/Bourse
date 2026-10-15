# SAVY — Tableau macroéconomique

Un tableau de bord en français pour suivre le cycle économique aux États-Unis et au Canada, à partir des observations publiées sur **FRED**, par la **Banque du Canada** et par **Statistique Canada**.

## Fonctions

- **41 indicateurs** : taux, inflation, emploi, activité, crédit, marchés, immobilier, Canada et matières premières. Les taux de chômage désaisonnalisés canadien et américain se trouvent dans **Emploi**, avec leur mois de référence, leur variation en points de pourcentage et dix ans d’historique. Le Canada utilise directement le vecteur `2062815` du tableau 14-10-0287-01 de Statistique Canada; les États-Unis utilisent `UNRATE` (BLS via FRED).
- **Inflation canadienne** : IPC global sur 12 mois, calculé à partir du vecteur `41690973` du tableau 18-10-0004-01; CPI-trim (`108785715`) et CPI-median (`108785714`) déjà exprimés en variation annuelle, issus du tableau 18-10-0256-01. Les trois séries viennent directement de Statistique Canada et sont présentées dans **Inflation**.
- **Demandes initiales d’assurance-chômage** : série hebdomadaire `ICSA` et moyenne mobile officielle sur quatre semaines `IC4WSA`, dans **Emploi**. Les valeurs sont des nombres de demandes par semaine, jamais des totaux mensuels ou sur quatre semaines.
- **Taux réel américain à 10 ans** : rendement quotidien des TIPS à échéance constante `DFII10`, dans **Taux**, distinct du rendement nominal et de l’inflation courante.
- **Graphiques interactifs** avec périodes de 1 mois, 3 mois, 1 an, 5 ans et 10 ans; valeurs au survol et navigation avec les flèches du clavier.
- **Vue détaillée** : explication de l’indicateur, dernières observations, lien vers la source et export de l’historique.
- **Recherche**, filtres par catégorie, tri par nom ou date, et **favoris** conservés dans le navigateur.
- **Export CSV** de la sélection, compatible avec Excel et protégé contre les formules dans les champs texte.
- **Modes clair et sombre**, disposition adaptée au téléphone et dialogues accessibles au clavier.
- **Nouvelles sélectionnées pour leur effet sur les marchés** : 1 à 6 sujets récents en français, chacun avec sa publication datée, son lien et la raison de le surveiller. Sous le briefing, 3 à 4 points expliquent les graphiques FRED à surveiller avec leur vraie période d’observation. Aucun quota de mots.
- **Briefing à écouter** : lecture vocale de l’édition publiée, avec priorité à une voix française canadienne, lecture/pause/reprise, sujets précédent/suivant, sélection du sujet, progression et vitesse réglable. Le lecteur reprend le texte des nouvelles et de leurs implications ainsi que les graphiques à surveiller; aucune position privée n’entre dans la narration. Il ne démarre qu’après une action de l’utilisateur et conserve la lecture lors d’une actualisation inchangée. La page doit rester ouverte; il ne s’agit pas d’un fichier audio téléchargeable.
- **USD/CAD de marché** : cours médian indicatif de biquote demandé au navigateur chaque minute, avec heure et statut du marché; les observations passées du portefeuille utilisent les clôtures quotidiennes Yahoo Finance et le dernier point peut utiliser la cotation de séance.
- **Décisions Fed et Banque du Canada** : fourchette cible américaine officielle et probabilités de hausse, maintien ou baisse à la prochaine réunion, issues des swaps SOFR/CORRA selon BlueGamma et affichées avec leur date.
- **Six graphiques de marchés mondiaux** : S&P 500, Nasdaq Composite, S&P/TSX Composite, STOXX Europe 600, FNB EEM suivant le MSCI Emerging Markets et FEQT (Fidelity All-in-One Equity) en CAD. Historique de clôtures et dernier cours en séance, périodes de 1 jour à 10 ans incluant YTD, rendements en % et sources accessibles.
- **Portefeuille privé** : quantités conservées dans le navigateur, valorisation en CAD, prix moyens, gains latents, pondérations et variations par titre, import/export JSON et graphique YTD, 6 mois, 3 mois, 1 mois, 1 semaine et 3 jours.
- **Vue compacte du portefeuille** : positions repliées par défaut, choix mémorisé sur l’appareil, et tri croissant/décroissant des gains latents en % et en CAD ainsi que des variations en CAD.
- **Point quotidien des positions** : les trois meilleures et les trois moins bonnes performances en %, en CAD avec le change, actualisées avec les cours. Les boutons YTD, 6 mois, 3 mois, 1 mois, 1 semaine et 3 jours permettent de choisir la période du classement; un mois glissant reste sélectionné par défaut. Le survol du graphique affiche date, montant et % depuis le début de la période affichée.
- Arbres de décision NFCI et TEV/EBITDA et ressources complémentaires conservés.

Les périodes de graphique se terminent à la dernière observation de chaque série. Une flèche indique le sens de variation depuis l’observation précédente, dont la date est disponible au survol. Les périodes mensuelles et trimestrielles sont affichées comme telles.

## Cotations en séance

Les cours de **tous les titres du catalogue, des six marchés et du VIX/XAU/VXEEM** disposent d’un instantané de la dernière cotation Yahoo Finance. La cotation source, sa devise, sa place boursière, sa vraie heure et le calendrier de séance sont vérifiés. Il s’agit du cours de la séance régulière; les cours après fermeture ne sont pas utilisés. Les cotations CDR restent distinctes des actions américaines, et aucun CFD ne remplace un titre ou un indice.

`Intraday quotes` collecte les instantanés toutes les cinq minutes, de 3 h à 16 h 57 en semaine à Montréal, pour couvrir l’Europe et l’Amérique du Nord. La publication GitHub et le fournisseur peuvent ajouter un délai : ce service n’est pas un flux tick par tick garanti. La page relit les instantanés chaque minute lorsqu’elle est visible. Le taux USD/CAD indicatif conserve son appel direct biquote chaque minute. Le dernier cours, les marchés fermés, les observations anciennes et le repli sur une clôture sont indiqués. Les instantanés sont des fichiers générés lors du déploiement; les historiques officiels et les positions personnelles ne sont jamais modifiés par ce workflow.

Le workflow de cotations publie seulement un commit source qui a déjà réussi les contrôles complets, puis valide les nouvelles données et les calculs financiers. Il partage la file de déploiement de SAVY, pour préserver les autres mises à jour. Une panne conserve la publication existante et ses dates. Le navigateur refuse un instantané global plus ancien et conserve les dernières cotations plus récentes déjà reçues.

Les graphiques des indices incluent le cours de séance comme dernier point et recalculent le rendement de chaque période. Les trois portefeuilles incluent les dernières cotations disponibles dans leurs valeurs, gains latents, répartitions, classements, contributions et dernière observation du graphique. Les références FEQT, VBAL et VGRO suivent le même mécanisme. Les contributions s’additionnent au rendement affiché; le change historique est conservé avant l’observation courante. Les cotations intrajournalières restent séparées des clôtures : volatilité, bêta et baisse maximale utilisent uniquement les séances clôturées communes. Une fermeture canadienne ne crée pas une séance fictive à partir d’un cours de change du jour.

Pour les indicateurs macro, le VIX, le PHLX XAU et VXEEM utilisent leur cotation lorsqu’elle est disponible; leur graphique historique reste FRED. USD/CAD utilise biquote sur la carte macro comme dans le bandeau. Trois compléments explicitement distincts sont proposés : indice de rendement Cboe TNX pour le 10 ans, contrat WTI proche pour le pétrole et DXY pour le dollar. Ils ne remplacent pas une série FRED de maturité constante, de pétrole spot ou de panier large par un instrument différent.

`Fresh macro releases` relit les publications officielles à 8 h 37, 9 h 52, 10 h 07, 14 h 07 et 14 h 37 en semaine, en plus des collectes habituelles. FRED, la Banque du Canada et Statistique Canada sont les sources des statistiques économiques et des décisions; leurs périodes de référence restent intactes.

## Mise à jour et fiabilité

GitHub Actions collecte les observations FRED, les taux directeurs, les probabilités des prochaines réunions, les cours des cinq marchés et ceux du catalogue public de 102 titres avec le taux USD/CAD quotidien **à 6 h 47 chaque jour**, puis à **13 h 17 et 19 h 17 du lundi au vendredi**, à l’heure de Montréal. Le navigateur demande séparément la cotation de change indicative à biquote à l’ouverture et chaque minute tant que l’onglet est visible. Les horaires suivent les changements d’heure; GitHub peut retarder une exécution en cas de charge.

Le **briefing d’actualité** est préparé et publié par la tâche ChatGPT quotidienne à **7 h, heure de Montréal**. Elle choisit les 1 à 6 développements les plus récents et importants pour les marchés, d’après les articles consultés de **Reuters, Financial Times, Wall Street Journal, New York Times et Bloomberg**, d’autres sources fiables et les publications officielles. Elle privilégie les dernières 24 heures, ou les 72 dernières heures en fin de semaine. Elle explique l’effet possible sur les taux, les bénéfices, les devises ou le portefeuille. Les faits, prévisions et interprétations restent distincts; la date de chaque source est visible. La longueur suit l’importance et la complexité de l’actualité. Elle peut dépasser 500 mots lorsque des faits et une analyse utiles le justifient, sans plafond global ni par nouvelle; aucun sujet anecdotique ni répétition ne sert à allonger le texte. En l’absence de nouvelle importante, elle publie moins d’articles et date les développements encore pertinents, sans remplir artificiellement le briefing.

La tâche de rédaction actualise `data/daily-briefing.json` dans ce dépôt, y compris les 3 à 4 explications `fred_watch` (série, observation, explication et lien FRED). Les commentaires sont datés de leur observation et revus à chaque édition, sans transformer la date de collecte en date économique. La collecte des observations ne modifie jamais ce fichier. La date d’édition des nouvelles est indépendante de celle des graphiques. En cas de panne, le navigateur peut conserver la dernière édition vérifiée, avec sa date et un avertissement visible. Si la préparation quotidienne échoue, l’édition précédente reste affichée et n’est pas présentée comme nouvelle.

Le bouton **Écouter le briefing** utilise une narration naturelle en français canadien, avec la voix de synthèse Sylvie. Le champ facultatif `audio_script` contient une adaptation rédigée pour l’oral : `edition_date`, `source_generated_at` identiques à l’édition écrite, `intro`, `stories` (mêmes titres et même ordre, avec `text` reformulé), `watch` et `outro`. Les phrases sont plus courtes, les transitions relient les nouvelles, les chiffres retenus servent l’explication et les faits restent distincts de l’analyse. La date de préparation, les données attendues et les périodes de cotation restent explicites. Le texte écrit conserve sa longueur et ses sources.

`scripts/generate_briefing_audio.py` génère les chapitres avec `edge-tts` (voix `fr-CA-SylvieNeural`, débit légèrement ralenti), puis les assemble en un MP3 avec FFmpeg. Le manifeste et l’audio sont des fichiers de déploiement ignorés par Git. Le cache GitHub Actions réutilise la narration pour une édition identique lors des rafraîchissements de cours. Le navigateur accepte seulement un manifeste dont le texte et les chapitres correspondent exactement à l’édition chargée; il conserve la lecture sur l’appareil si la narration est indisponible. La lecture ne démarre qu’après un clic et garde pause, reprise, vitesse et navigation entre sujets. Les positions privées ne participent jamais à la génération audio.

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

La section **Résultats trimestriels** affiche le calendrier de la semaine, filtré dans le navigateur sur les titres détenus. Le sélecteur couvre les douze semaines précédentes et les cinq suivantes. Le BPA, les revenus publiés, le consensus et les surprises utilisent des montants comparables d’un même fournisseur, dans la devise indiquée. Les valeurs absentes ne sont pas extrapolées et aucun résultat futur n’est présenté comme publié. Les calendriers Yahoo Finance et MarketBeat couvrent le catalogue public, sans lire les positions privées; les doubles cotations utilisent les résultats de l’entreprise sous-jacente et les FNB restent hors du calendrier d’entreprise.

**Messages clés : toujours trois ou quatre points français relus et sourcés**, liés à l’entreprise, à la date et au compte rendu exact dans `data/earnings-highlights.json`. Ils expliquent les moteurs opérationnels, les messages du PDG/directeur financier et les révisions de perspectives, les marges/cash-flow/investissements, puis les risques et ce qui change pour la thèse. Les faits et les prévisions restent distincts; une interprétation est identifiée comme telle. Le tableau donne déjà le beat/miss : les points ne le répètent pas comme substitut à une analyse. Aucun titre générique de type « strong performance », liste de mots-clés en anglais ou définition du BPA ne remplit une fiche. Si les sources ne permettent pas encore une analyse fiable, le site indique que la vérification est en attente au lieu d’inventer ou de compléter artificiellement les points.

La tâche éditoriale du matin révise les résultats nouvellement publiés dans le catalogue public et ajoute les analyses au fichier de messages. `python scripts/collect_portfolio_earnings.py --validate-reviewed` contrôle les trois ou quatre points distincts et les sources; `--apply-reviewed-only` les intègre à `data/portfolio-earnings.json` sans modifier les chiffres, les dates de publication ni la fraîcheur des collectes. Les trois actualisations de données existantes reprennent ensuite ces notes, même si les sources numériques nécessitent un repli. **Image de la semaine** exporte les mêmes points complets avec une hauteur adaptée au texte. Les sources et dates restent visibles; une panne conserve l’ancienne date et ne devient jamais une semaine sans résultat.

Les boutons **Secteurs** et **Géographie**, à côté des positions, ouvrent deux tableaux : poids du portefeuille, poids de FEQT et écart en points de pourcentage. Les poids utilisent les valeurs actuelles des titres en CAD, avec le taux USD/CAD courant. Les FNB sont décomposés selon leurs placements sous-jacents. Vanguard fournit les secteurs GICS des titres, ce qui permet d’harmoniser ses FNB avec Fidelity et BlackRock; les obligations restent une catégorie distincte. Les dates et sources de chaque répartition sont affichées. Les pays correspondent aux pays de risque publiés par l’émetteur, et non à la devise, au lieu de cotation ou à la répartition du chiffre d’affaires. Les pays que Fidelity ne détaille pas restent regroupés : une absence n’est pas interprétée comme une exposition nulle. Les répartitions incomplètes restent dans le dénominateur et aucun écart exact n’est inventé. Les quantités personnelles sont calculées uniquement dans le navigateur.

`scripts/collect_portfolio_exposures.py` vérifie les sources Fidelity, BlackRock, Vanguard et QQQM tous les sept jours dans la collecte existante, conserve les dates réellement publiées et garde la dernière répartition datée en cas de panne. QQC utilise sa dernière part QQQM publiée par CI et les dernières positions QQQM; les dates distinctes et la comparaison indicative sont signalées. Les sources statiques et les classifications manquantes sont identifiées dans le fichier public, qui ne contient aucune quantité personnelle.

L’historique est une **reconstitution avec les quantités actuelles constantes**, cours de clôture hors dividendes et taux USD/CAD disponible à chaque date. Il ne reproduit pas les dépôts, retraits, achats, ventes, espèces ou frais du compte. Un historique réel exige les transactions et mouvements d’argent. YTD compare la dernière date à la dernière clôture de l’année précédente; les périodes de six, trois et un mois partent de la dernière séance disponible à la date de référence; une semaine et trois jours correspondent à cinq et trois séances. Une base de comparaison manquante n’est jamais remplacée par un rendement fictif.


Le **lien personnel** ouvre automatiquement un portefeuille intégré, sans fichier à télécharger ou importer. Les positions intégrées sont publiées uniquement sous forme chiffrée (AES-GCM); la clé reste dans le fragment du lien et sur l’appareil. Le manifeste généré dans le navigateur garde ce lien comme adresse de démarrage pour un nouveau raccourci d’écran d’accueil. Les simples actualisations et réouvertures conservent les modifications locales. Une nouvelle révision authentifiée des positions intégrées remplace la base précédente; une panne ou un lien invalide conserve les positions existantes. Sans lien personnel ni positions enregistrées, le site reste vide.

Pour mettre à jour la base intégrée, exécuter `node scripts/seal_personal_portfolio.cjs PRIVATE_INPUT data/personal-portfolio.json` avec la sauvegarde privée placée hors du dépôt. Le script conserve le lien dans le champ privé `savy_access`, réutilise sa clé, change le nonce et la révision, puis écrit uniquement le profil chiffré dans le dépôt. La sauvegarde et son lien restent hors du dépôt et des journaux publics.

### Heatmap des portefeuilles

La heatmap des portefeuilles 1, 2 et 3 utilise les seules positions déjà présentes dans le navigateur. Chaque surface est proportionnelle à la valeur actuelle en CAD; la couleur indique le rendement de cours dans la devise de cotation, hors dividendes et hors variation USD/CAD. Les périodes Jour, 1 semaine (5 séances), 1 mois, 3 mois et YTD sont indépendantes du graphique principal et mémorisées par portefeuille. Le détail au toucher, au clavier ou via le sélecteur donne variation, valeur, poids, cours, date réelle et base historique. Les petites positions restent accessibles sans agrandissement artificiel.

L’échelle rouge/gris/vert est symétrique et plafonne seulement la couleur, jamais le rendement affiché. Une base absente ou une séance antérieure donne N/D, pas zéro. Une valorisation incomplète affiche explicitement une carte partielle, conserve tous les titres dans le sélecteur et ne prétend pas connaître leurs poids exacts. Aucun nouveau service, transmission de positions ni changement aux profils chiffrés. Le calcul et le treemap sont testés dans `tests/portfolio-heatmap-utils.test.cjs`, avec interactions et mobile dans `tests/portfolio-browser.cjs`.

### Courbes de taux souverains

La section **Courbes de taux · États-Unis et Canada** compare uniquement **deux dates, A et B**. Les raccourcis **1 jour, 1 semaine, 1 mois, 3 mois, 6 mois, 1 an, 2 ans, 5 ans et YTD** se trouvent ensemble à côté des sélecteurs. Ils partent des dernières observations publiées. « 1 jour » retrouve la séance publiée précédente, même après un congé; « 1 semaine » recule de sept jours civils, les mois et années utilisent le calendrier et YTD part de la fin de l’année précédente. Les deux dates restent modifiables et mémorisées. Les anciens choix A/B sont conservés et les dates C/D/E supprimées.

Chaque pays affiche les dates réellement utilisées, les écarts `B − A` en points de base, les variations des taux 2 et 10 ans et les pentes 10 ans − 2 ans / 10 ans − 3 mois. Le tableau détaillé, le survol, le toucher et les flèches du clavier couvrent toutes les échéances.

`scripts/collect_yield_curves.py` collecte les courbes nominales au pair du **U.S. Treasury** (CSV annuels, 1 mois à 30 ans) et les séries quotidiennes **Banque du Canada / CanDeal DNA** (bons 1/3/6/12 mois, obligations de référence 2/3/5/7/10 ans et long terme). Le long canadien est une émission de référence d’environ 30 ans avec échéance résiduelle variable, et non un taux zéro-coupon à maturité fixe. Les deux pays ont des méthodes distinctes, précisées dans leurs sources. Les échéances sont espacées uniformément dans chaque graphique.

L’historique `data/yield-curves.json` débute en 2016. Une date sans publication utilise une seule observation antérieure par pays, au plus sept jours avant, avec date effective explicite. Aucun taux manquant n’est repris d’une autre séance ou interpolé; il reste N/D et interrompt la ligne. Les rendements négatifs sont admis. Les collectes quotidiennes et macro existantes actualisent ce fichier; les années Treasury anciennes sont revérifiées chaque semaine. Une panne conserve l’historique et l’horodatage de réussite du pays concerné; le navigateur dispose aussi d’un cache daté indépendant.

Les contrats de sources, les dates, les taux, les écarts et les reprises sont contrôlés par `tests/test_yield_curves.py`, `tests/yield-curve-utils.test.cjs` et `tests/yield-curves-browser.cjs`.

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

Le validateur vérifie les liens HTTPS, les dates, le nombre raisonnable de sujets et la présence d’un résumé et d’une implication substantiels, sans plafond de mots. Le déploiement Pages exécute cette vérification avant publication.

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


### Trois portefeuilles indépendants

Le sélecteur **Portefeuille 1 / Portefeuille 2 / Portefeuille 3** utilise FEQT pour le premier, VBAL (VBAL.TO, CAD) pour le deuxième et VGRO (VGRO.TO, CAD) pour le troisième. Les positions, prix moyens, imports, exports, périodes, filtres et vues sont enregistrés séparément sur l’appareil. Les cotations et sources publiques sont communes. Les courbes, écarts, volatilités, baisses maximales et bêtas utilisent la référence choisie; les secteurs et la géographie comparent les placements sous-jacents à cette même référence. Les obligations et l’or physique restent des expositions distinctes. Les FNB couverts XSP et XSU utilisent les actifs au comptant positifs normalisés, hors contrats de couverture, pour ne pas transformer une exposition américaine en Canada. Les sources expliquent la base, les résidus et les dates.

Le profil chiffré du deuxième portefeuille est `data/personal-portfolio-2.json`. Il réutilise la clé du lien personnel et authentifie aussi son identifiant de portefeuille; un profil du premier ne peut pas remplacer celui du second. Le manifeste d’écran d’accueil garde le portefeuille sélectionné dans le fragment d’URL. Pour modifier la base du deuxième, utiliser une sauvegarde privée avec `portfolio_id: "2"` et son accès personnel, puis `node scripts/seal_personal_portfolio.cjs PRIVATE_INPUT data/personal-portfolio-2.json`. Aucune quantité ni clé n’est enregistrée en clair dans le dépôt. Les données de XLF proviennent du fichier XLSX daté de State Street; les soldes hors actions ne sont pas assimilés au secteur financier.

Le troisième profil est `data/personal-portfolio-3.json`, créé de la même façon avec `portfolio_id: "3"` et VGRO comme référence. Son identifiant est authentifié séparément et son lien d’écran d’accueil conserve la sélection 3. La cotation Microsoft CDR utilise `MSFTCDR` / `MSFT.TO` en CAD; l’action américaine `MSFT` en USD reste distincte. Ses résultats trimestriels proviennent de Microsoft et gardent leur devise USD. CASH est classé en liquidités, FBAL distingue les obligations et les cryptoactifs, et les nouveaux fonds citent leur émetteur avec la date des répartitions. Les tests vérifient les trois profils, leurs modifications indépendantes, les références VBAL/VGRO et les affichages mobiles, exclusivement avec des quantités synthétiques.


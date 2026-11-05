# SAVY — Comité d’investissement dans Analyse

L’onglet **Portefeuilles → Analyse** affiche directement la revue du jeudi à 3 h
(`America/Toronto`), sur la clôture du mercredi et le dernier Finviz disponible.
Les mandats restent OS/FEQT, JMC/VBAL et MCL/VGRO. Aucun nouvel onglet n’est créé.

| Rubrique | Contenu |
| --- | --- |
| Synthèse | Résumé exécutif et surveillance |
| OS · FEQT | Positions, risque actif, valorisation, Finviz et rotations |
| JMC · VBAL | Allocation équilibrée, obligations et décisions |
| MCL · VGRO | Croissance équilibrée, diversification et décisions |
| Optimisation | Comparaison, scénarios actuels, optimisés et recommandés |
| Décisions & suivi | Recommandations et suivi des éditions précédentes |
| Rapports | Historique, PDF, méthodologie, sources et limites |

## Publication sur le GitHub SAVY existant

Les rapports et leur PDF sont regroupés dans une enveloppe **chiffrée** publiée
dans `data/committee/AAAA-MM-JJ.json`. L’index chronologique
`data/committee-reports.json` contient uniquement date, chemin local, identité
de la clé publique et empreinte du fichier chiffré. Aucun rapport, poids, montant
ou PDF personnel en clair ne doit être ajouté au dépôt public.

Le destinataire est défini par `data/committee-public-key.json`. **Ce fichier ne
contient qu’une clé publique.** Le producteur n’a pas besoin de la clé privée pour
publier les prochaines éditions. Ne pas remplacer ou régénérer le destinataire
dans une exécution de routine.

Le lien privé remis au propriétaire active l’accès dans son navigateur. La clé
est consommée dans le fragment `committee-key` avant la navigation du portail,
puis retirée de la barre d’adresse. Elle reste uniquement dans le navigateur et
dans la copie personnelle d’accès conservée par le propriétaire. Elle ne doit
jamais être committée, mise dans une requête HTTP, un lien public, un prompt de
tâche ou les journaux. Les clés existantes des positions ne sont pas modifiées.

Le lecteur déchiffre le rapport et le PDF dans la page SAVY existante, sans iframe
ni hébergement externe. Il vérifie l’empreinte du fichier, l’identité du
destinataire, l’authentification du contenu, les dix sections et l’empreinte du PDF.
Le PDF téléchargeable est créé dans le navigateur à partir des octets déchiffrés.
Les anciennes éditions importées sur l’appareil restent accessibles.

## Livraison par la tâche du jeudi

1. Repartir du `main` courant et appliquer le mandat analytique complet.
2. Vérifier les données des comptes via les sources autorisées. Ne pas contourner
   les enveloppes des positions ni inventer des quantités, performances ou ratios.
3. Produire et contrôler le PDF complet et son JSON compagnon dans l’espace
   personnel de l’utilisateur. Les fichiers doivent contenir les dix analyses
   effectives ci-dessous, les dates vérifiées et les limites.
4. Valider le JSON avec `SavyPortfolioBriefingUtils.normalize`, puis chiffrer :
   `python scripts/encrypt_committee.py --report /chemin/prive/rapport.json --pdf /chemin/prive/rapport.pdf`
   Installer si nécessaire `scripts/requirements-committee.txt`. Ne fournir à
   ce script que la clé **publique** existante.
5. Le script préserve l’index et toutes les autres dates. Publier dans
   `osavaria11-bot/Bourse` seulement le fichier chiffré de cette date et l’index
   actualisé. Ne jamais publier les entrées privées utilisées par le script.
6. Vérifier le validateur du lecteur, les tests de compatibilité Python/WebCrypto,
   les empreintes des fichiers et la publication Pages. Une production de fichiers
   sans commit ni publication ne remplit pas Analyse et n’est pas une livraison.
7. Conserver les copies personnelles du PDF/JSON. Aucun import manuel ne doit être
   nécessaire pour une édition publiée quand l’accès privé est déjà activé.

### Format du JSON compagnon privé

`schema_version: 1`, `date`, `data_date`, `finviz_date`, et `sections` :
`summary`, `os`, `jmc`, `mcl`, `comparison`, `optimization`,
`recommendations`, `follow_up`, `outlook`, `methodology`.

Chaque section contient son analyse complète en Markdown, avec tableaux et liens
de sources. Le lecteur crée uniquement du texte et des éléments DOM contrôlés :
aucun HTML fourni par un rapport n’est exécuté. Un champ facultatif `pdf_url`
peut conserver un lien personnel Library validé pour les anciens imports; le PDF
des éditions chiffrées est téléchargé directement depuis le lecteur.

## Protocole et vérifications

Version 1 : ECDH P-256 éphémère, HKDF SHA-256 et AES-256-GCM; sel de 32 octets,
nonce de 12 octets, tag de 128 bits. L’information HKDF est
`SAVY committee v1` et l’AAD lie version, date et destinataire.
Chaque publication utilise un nouvel éphémère, un nouveau sel et un nouveau nonce.
L’index lie chaque date à l’empreinte SHA-256 de ses octets publiés.

`node --test tests/committee-crypto-utils.test.cjs tests/portfolio-briefing-utils.test.cjs`

Les contrôles couvrent la compatibilité de publication Python et de lecture
WebCrypto, la corruption de contenu, un mauvais destinataire, les dix sections,
les octets PDF, la conservation des dates, le rechargement, l’absence de clé dans
les requêtes, les anciens imports et les vues ordinateur/mobile. Les tests
n’utilisent que des destinataires et analyses fictifs.

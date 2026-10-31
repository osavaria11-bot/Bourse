# SAVY — Comité d’investissement des portefeuilles personnels

L’onglet existant **Portefeuilles → Analyse** présente la revue du jeudi à 3 h
(`America/Toronto`). Le titre de la page reste « Analyse du portefeuille ».
Les données de référence sont la clôture du mercredi et le dernier rapport
Finviz effectivement disponible. Le comité couvre OS/FEQT, JMC/VBAL et MCL/VGRO.

## Disposition de la lecture

| Rubrique dans Analyse | Contenu du mandat |
| --- | --- |
| Synthèse | Résumé exécutif, cinq conclusions, catalyseurs et surveillance |
| OS · FEQT | Performance, positions, fondamentaux, forward, risque actif, candidats Finviz et financement des rotations |
| JMC · VBAL | Mandat équilibré, allocation, obligations, duration, crédit, protection et recommandations |
| MCL · VGRO | Mandat de croissance équilibrée, diversification, facteurs, risque et recommandations |
| Optimisation | Comparaison relative des trois portefeuilles et scénarios actuel/optimisé/recommandé, hypothèses, stress et probabilités défendables |
| Décisions & suivi | Recommandations, poids cibles, convictions et suivi des recommandations antérieures |
| Rapports | Historique chronologique, import/export privés, méthodologie, sources et limites |

L’interface ne calcule et n’invente aucun résultat de comité à partir de la simple
disponibilité d’un portefeuille. Les chiffres affichés proviennent du rapport importé.
Une rubrique absente reste explicitement sans analyse.

## Livraison d’une édition par la tâche planifiée

1. Lire et appliquer le mandat complet enregistré dans la tâche. Ce document
   définit son format d’intégration, pas une réduction de son contenu analytique.
2. Vérifier les positions via une source authentifiée autorisée. Ne pas contourner
   les enveloppes AES-GCM des positions et ne jamais demander ou exposer leurs clés.
3. Produire et vérifier le PDF complet en français. Le conserver dans un espace
   personnel autorisé. Vérifier que le document lui-même est protégé.
4. Produire un fichier JSON compagnon avec les sections ci-dessous et les dates
   effectivement utilisées. Omettre une date ou une section inconnue; ne pas inventer
   des valeurs, des positions, des rendements ou des recommandations Finviz.
5. Si le PDF a été sauvegardé dans le compte personnel ChatGPT Library avec un
   accès approprié, reprendre son lien exact retourné par Library dans `pdf_url`.
   Ne pas fabriquer de `library_file_id`. L’interface n’accepte ici que le format
   personnel `https://chatgpt.com/library?file_id=…&account_id=personal`.
6. Remettre à l’utilisateur le PDF et le JSON compagnon **en privé**. Ils peuvent
   être chargés via « Ajouter un rapport ». Vérifier la date avant l’enregistrement.

Le site GitHub Pages est public. **Ne jamais committer le PDF personnel, son JSON,
les positions, les poids ou les montants privés dans ce dépôt.** Un lien masqué dans
l’interface ne protège pas un fichier public. Ne pas ajouter un PDF externe public
comme s’il était privé. Le lien Library est une référence à ouvrir dans le compte
ChatGPT de l’utilisateur; la tâche reste responsable de vérifier les autorisations
du fichier qu’elle crée ou choisit.

L’import fonctionne dans le navigateur de l’utilisateur. Il n’est pas une API de
publication distante et ne lit pas automatiquement une tâche ChatGPT en arrière-plan.
Une publication sans intervention dans SAVY nécessite un chemin privé authentifié
supplémentaire; ne pas annoncer cette intégration comme active tant qu’elle ne l’est
pas. En son absence, livrer les fichiers privés et expliquer cette limite.

## Format du fichier compagnon

Les noms de clés sont fixes. Les contenus des sections sont du texte Markdown :
paragraphes, titres, listes, tableaux et liens HTTPS de sources. Aucun HTML n’est
exécuté et aucune image ou iframe distante n’est chargée à partir du rapport.

```json
{
  "schema_version": 1,
  "date": "AAAA-MM-JJ",
  "data_date": "AAAA-MM-JJ",
  "finviz_date": "AAAA-MM-JJ",
  "sections": {
    "summary": "Résumé exécutif : cinq conclusions, risques, changements et décisions majeures.",
    "os": "Analyse complète OS — FEQT, y compris Finviz, rotations et scénarios OS A/B/C.",
    "jmc": "Analyse complète JMC — VBAL, adaptée au profil équilibré.",
    "mcl": "Analyse complète MCL — VGRO, adaptée au profil de croissance équilibrée.",
    "comparison": "Comparaison relative des trois portefeuilles.",
    "optimization": "Actuel / optimisé / recommandé, horizons 1/3/5 ans, scénarios et hypothèses.",
    "recommendations": "Décisions, poids actuels vérifiés, cibles, convictions et justifications.",
    "follow_up": "Suivi des décisions précédentes et revue approfondie au premier jeudi du mois.",
    "outlook": "Résultats trimestriels, événements, catalyseurs et risques à surveiller.",
    "methodology": "Méthodes, sources, dates, limites et distinction vérifié / estimé / hypothétique."
  }
}
```

Cet exemple décrit le schéma, ce n’est pas un rapport à publier : remplacer les dates
par des dates réelles et les descriptions par l’analyse. `data_date`, `finviz_date`
et `pdf_url` sont facultatifs. Ne pas inclure `pdf_url` sans lien réel et autorisé.
Le champ `text` ou `markdown` permet aussi un rapport intégral; le lecteur reconnaît
les titres des dix sections du PDF. Les sections JSON évitent les ambiguïtés de titres.

Un historique exporté utilise `{"schema_version":1,"editions":[...]}`. L’import
contrôle tout le lot avant de le conserver. Il fusionne par date et met à jour une
édition de la même date sans supprimer les autres. Les anciennes éditions en texte
du stockage `savy:portfolio-private-briefings:v1` restent lisibles. La limite roulante
de douze rapports a été retirée. Si le stockage est saturé, l’enregistrement échoue
avec un message et l’historique précédent demeure intact.

## Vérifications

`node --test tests/portfolio-briefing-utils.test.cjs tests/portal-utils.test.cjs`

Les tests du portail vérifient aussi la lecture par portefeuille, les tableaux,
l’import d’une édition structurée, la conservation des anciennes éditions et le
retour aux autres rubriques. Aucun jeu de test ne contient de positions réelles.

# Actualisation des multiples forward

Le module est désormais intégré au dernier onglet de Recherche, à la demande
de l’utilisateur du 2 novembre 2026. Voir [la documentation courante](forward-valuation.md).

Le briefing du matin exécute `python scripts/refresh_forward_internal.py --data-only`
et publie `data/forward-valuation.json` avec ses autres changements autorisés.
L’ancien repli de remplacement d’un HTML privé n’est plus nécessaire pour le site.

L’export HTML autonome demeure un outil facultatif de développement. Son paquet
embarqué contient uniquement le code de ce module et son catalogue public, sans
positions privées. Il ne publie rien par lui-même.

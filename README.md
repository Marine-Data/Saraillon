# Saraillon

Application web pour organiser un séjour entre amis : un espace réservé au groupe, où chaque séjour n'est visible que par ses membres.

Le projet est né d'une application faite pour un séjour réel en août 2026 (planning, défis, repas, galerie, messages). Il est en train de devenir une application ouverte à tous, construite par étapes.

## Où en est le projet

| Étape | Contenu | État |
|---|---|---|
| 1 | Comptes, création de séjour, invitation par code, membres | ✅ |
| 2 | Configuration du séjour depuis l'appli : participants, planning, corvées, défis | à venir |
| 3 | Fonctions du séjour : chat, galerie, courses, dépenses, défis | à venir |
| 4 | Politique de confidentialité, mentions légales, suppression de compte | à venir |
| 5 | Mise en ligne publique | à venir |

## Protection des données dès la conception

- **Cloisonnement par séjour** : les règles de sécurité de la base (Row Level Security de PostgreSQL) n'autorisent une personne à lire un séjour et ses membres que si elle en fait partie. L'interface n'a aucun moyen de contourner ces règles.
- **Rien pour les visiteurs non connectés** : aucun droit d'accès aux tables pour le rôle anonyme.
- **Actions sensibles côté base** : créer, rejoindre ou changer le code d'un séjour passe par des fonctions de la base qui vérifient l'identité et le rôle de la personne.
- **Minimisation** : un compte ne contient que l'e-mail ; le prénom est donné séjour par séjour et n'apparaît qu'aux membres de ce séjour.
- **Suppression en cascade** : supprimer un séjour efface ses membres ; supprimer un compte efface ses appartenances.
- **Hébergement dans l'Union européenne** (Supabase, région Stockholm).
- **Aucune donnée personnelle dans ce dépôt.**

Les règles sont décrites et testées dans [`sql/001_sejours.sql`](sql/001_sejours.sql).

## Technique

- HTML, CSS et JavaScript sans framework, modules ES.
- [Supabase](https://supabase.com) : authentification par e-mail et mot de passe, base PostgreSQL, règles d'accès.
- E-mails d'authentification envoyés via un serveur SMTP dédié.

## Lancer en local

Servir le dossier avec n'importe quel serveur statique, par exemple :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000.

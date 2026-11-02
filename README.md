# Planya

**Organiser ses vacances à plusieurs** — en ligne : https://planya.netlify.app

Application web pour organiser un séjour entre amis : un espace réservé au groupe, où chaque séjour n'est visible que par ses membres.

Le projet est né de « Saraillon », une application faite pour un séjour réel en août 2026 (planning, défis, repas, galerie, messages). Il est en train de devenir une application ouverte à tous, construite par étapes.

## Où en est le projet

| Étape | Contenu | État |
|---|---|---|
| 1 | Comptes, création de séjour, invitation par code, membres | ✅ |
| 2 | Planning : activités jour par jour, choses à apporter, inscriptions, commentaires | ✅ |
| 3 | Dépenses partagées : parts égales ou montants libres, soldes, remboursements | ✅ |
| 4 | Courses : liste partagée, rattachée aux repas du planning, « Je m'en occupe » | ✅ |
| 5 | Corvées : liste du groupe, tirage au sort équitable du jour, échanges à la main | ✅ |
| 6 | Voyage : fiche d'infos du séjour, « qui arrive quand », billets privés | ✅ |
| 7 | Valise : liste privée remplie avec les « choses à apporter » du planning, plus ses propres objets | ✅ |
| 8 | Missions secrètes : une mission par jour tirée au sort par la base, révélée à sa cible le dernier jour | ✅ |
| 9 | Sondages : votes anonymes (anonymes aussi dans la base) ou visibles, clôture | ✅ |
| 10 | Classement général en points (missions, corvées, activités), calculé par la base | ✅ |
| 11 | Fil d'actu : événements écrits par la base (impossibles à falsifier, sans secret), publications, likes, commentaires | ✅ |
| 12 | Chat du groupe, messages privés, notifications | à venir |
| 13 | Politique de confidentialité, mentions légales, téléchargement de ses données, suppression de compte | ✅ |

Planya est la version publique de « Saraillon » : mêmes fonctions et même esprit, réécrites module par module pour fonctionner avec n'importe quel groupe.

## Protection des données dès la conception

- **Cloisonnement par séjour** : les règles de sécurité de la base (Row Level Security de PostgreSQL) n'autorisent une personne à lire un séjour et ses membres que si elle en fait partie. L'interface n'a aucun moyen de contourner ces règles.
- **Rien pour les visiteurs non connectés** : aucun droit d'accès aux tables pour le rôle anonyme.
- **Actions sensibles côté base** : créer, rejoindre ou changer le code d'un séjour passe par des fonctions de la base qui vérifient l'identité et le rôle de la personne.
- **Comptes justes par construction** : une dépense ne s'enregistre que si la base vérifie que la somme des parts égale le montant et que chaque personne fait partie du séjour. Montants stockés en centimes, sans arrondi.
- **Minimisation** : un compte ne contient que l'e-mail ; le prénom est donné séjour par séjour et n'apparaît qu'aux membres de ce séjour.
- **Suppression en cascade** : supprimer un séjour efface ses membres ; supprimer un compte efface ses appartenances.
- **Billets privés** : les billets de train ou d'avion sont dans un espace de stockage privé, accessible à la seule personne qui les a déposés ; le groupe ne voit que les horaires. Quitter un séjour efface ses trajets et ses billets.
- **Hébergement dans l'Union européenne** (Supabase, région Stockholm).
- **Droits des personnes intégrés** : « Mon compte » permet de télécharger toutes ses données (fichier JSON) et de supprimer son compte. La suppression efface tout ce qui est personnel ; ce qui sert aussi au groupe (dépenses, activités) est anonymisé (« Ancien membre »). Quitter un séjour efface ses traces nominatives dans ce séjour, y compris les missions des autres qui contenaient son prénom.
- **Fichiers vraiment effacés** : la base note les fichiers à supprimer (billets, photos de missions) et une fonction planifiée les efface toutes les heures ([`supabase/functions/nettoyer-fichiers`](supabase/functions/nettoyer-fichiers/index.ts)).
- **Aucun service tiers dans le navigateur** : polices et bibliothèque Supabase hébergées avec le site, pas de Google Fonts ni de CDN, aucun traceur.
- **Aucune donnée personnelle dans ce dépôt.**

Les règles sont décrites dans [`sql/`](sql/) et testées avec plusieurs comptes avant chaque mise en ligne.

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

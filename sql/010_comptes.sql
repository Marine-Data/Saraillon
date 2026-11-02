-- Planya — droits des personnes : suppression de compte, départ d'un séjour, effacement des fichiers.
-- Prérequis : sql/001 à 009. À exécuter une fois dans Supabase (projet saraillon).
--
-- Principe : tout ce qui est personnel est effacé ; ce qui sert aussi au groupe (dépenses,
-- activités, courses, sondages créés) est gardé mais anonymisé : la personne n'y apparaît plus
-- que comme « Ancien membre », sans lien possible avec son identité.

-- 1. Supprimer un compte ne doit jamais supprimer le séjour des autres
--    (avant : supprimer la personne qui a créé un séjour effaçait le séjour entier).
alter table public.sejours drop constraint if exists sejours_cree_par_fkey;
alter table public.sejours alter column cree_par drop not null;
alter table public.sejours add constraint sejours_cree_par_fkey
  foreign key (cree_par) references auth.users (id) on delete set null;
alter table public.activites alter column cree_par drop not null;

-- Les activités gardent leur auteur figé, sauf quand le compte de l'auteur est supprimé.
create or replace function public.activites_maj() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  if new.cree_par is not null then new.cree_par := old.cree_par; end if;
  new.sejour_id := old.sejour_id;
  return new;
end $$;

-- La fiche du séjour ne note l'auteur que lors d'une vraie modification de son contenu.
create or replace function public.fiche_sejour_maj() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.sejour_id := old.sejour_id; end if;
  if tg_op = 'INSERT' or (new.adresse, new.acces, new.wifi, new.contacts, new.notes)
       is distinct from (old.adresse, old.acces, old.wifi, old.contacts, old.notes) then
    new.maj_le := now();
    new.maj_par := auth.uid();
  end if;
  return new;
end $$;

-- 2. Quand une personne quitte un séjour (ou en est retirée, ou supprime son compte) :
--    ses traces nominatives dans ce séjour sont effacées ou anonymisées.
--    (Valise, trajets, billets, missions, votes : effacés automatiquement par les clés étrangères.)
create or replace function public.depart_du_sejour() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Les missions des autres qui la visaient contiennent son prénom : on les efface.
  delete from public.missions_secretes where sejour_id = old.sejour_id and cible_id = old.user_id;
  update public.courses set pris_par = null where sejour_id = old.sejour_id and pris_par = old.user_id;
  update public.corvee_attributions set user_id = null where sejour_id = old.sejour_id and user_id = old.user_id;
  update public.fiche_sejour set maj_par = null where sejour_id = old.sejour_id and maj_par = old.user_id;
  delete from public.activite_inscriptions where sejour_id = old.sejour_id and user_id = old.user_id;
  delete from public.activite_commentaires where sejour_id = old.sejour_id and user_id = old.user_id;
  return old;
end $$;
drop trigger if exists depart_du_sejour on public.sejour_membres;
create trigger depart_du_sejour after delete on public.sejour_membres
  for each row execute function public.depart_du_sejour();

-- 3. Fichiers à effacer : la base ne peut pas effacer elle-même un fichier stocké ;
--    elle note son chemin, et la fonction « nettoyer-fichiers » l'efface (toutes les heures).
create table if not exists public.fichiers_a_effacer (
  bucket text not null,
  chemin text not null,
  ajoute_le timestamptz not null default now(),
  primary key (bucket, chemin)
);
alter table public.fichiers_a_effacer enable row level security;  -- aucune règle : invisible depuis l'appli
revoke all on public.fichiers_a_effacer from anon, authenticated;

create or replace function public.noter_fichier_billet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fichiers_a_effacer (bucket, chemin) values ('planya-billets', old.chemin) on conflict do nothing;
  return old;
end $$;
drop trigger if exists noter_fichier_billet on public.billets;
create trigger noter_fichier_billet after delete on public.billets
  for each row execute function public.noter_fichier_billet();

create or replace function public.noter_fichier_mission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.photo_chemin is not null and (tg_op = 'DELETE' or new.photo_chemin is distinct from old.photo_chemin) then
    insert into public.fichiers_a_effacer (bucket, chemin) values ('planya-missions', old.photo_chemin) on conflict do nothing;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists noter_fichier_mission on public.missions_secretes;
create trigger noter_fichier_mission after delete or update of photo_chemin on public.missions_secretes
  for each row execute function public.noter_fichier_mission();

revoke execute on function public.depart_du_sejour(), public.noter_fichier_billet(), public.noter_fichier_mission()
  from public, anon, authenticated;

-- 4. Supprimer son compte.
--    Si la personne est seule à organiser un séjour, l'organisation passe au membre le plus ancien ;
--    si elle était seule dans le séjour, le séjour est supprimé.
create or replace function public.supprimer_mon_compte() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := auth.uid();
  r record;
  v_suivant uuid;
begin
  if v_moi is null then raise exception 'Connecte-toi pour supprimer ton compte.'; end if;
  for r in
    select m.sejour_id from public.sejour_membres m
     where m.user_id = v_moi and m.role = 'organisateur'
       and not exists (select 1 from public.sejour_membres o
                        where o.sejour_id = m.sejour_id and o.role = 'organisateur' and o.user_id <> v_moi)
  loop
    select o.user_id into v_suivant from public.sejour_membres o
     where o.sejour_id = r.sejour_id and o.user_id <> v_moi order by o.rejoint_le limit 1;
    if v_suivant is null then
      delete from public.sejours where id = r.sejour_id;
    else
      update public.sejour_membres set role = 'organisateur' where sejour_id = r.sejour_id and user_id = v_suivant;
    end if;
  end loop;
  -- Effacement du compte : les appartenances, et tout ce qui en dépend, partent en cascade.
  delete from auth.users where id = v_moi;
end $$;
revoke execute on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.supprimer_mon_compte() to authenticated;

-- 5. Nettoyage des fichiers toutes les heures (appel de la fonction « nettoyer-fichiers »).
select cron.unschedule('planya-nettoyer-fichiers') where exists (select 1 from cron.job where jobname = 'planya-nettoyer-fichiers');
select cron.schedule('planya-nettoyer-fichiers', '17 * * * *', $$
  select net.http_post(
    url := 'https://iupghubmnibbdipingnj.supabase.co/functions/v1/nettoyer-fichiers',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb);
$$);

-- 6. Vérification : doit afficher 3 déclencheurs, 1 fonction de suppression et 1 tâche planifiée.
select
  (select count(*) from pg_trigger where tgname in ('depart_du_sejour', 'noter_fichier_billet', 'noter_fichier_mission')) as declencheurs,
  (select count(*) from pg_proc where proname = 'supprimer_mon_compte') as suppression,
  (select count(*) from cron.job where jobname = 'planya-nettoyer-fichiers') as nettoyage;

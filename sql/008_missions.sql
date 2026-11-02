-- Planya — missions secrètes.
-- Chaque jour du séjour, chaque membre reçoit une mission secrète visant un autre membre :
-- découvrir une info (réponse écrite) ou faire un geste (preuve photo).
-- Pendant le séjour, seule la personne voit sa mission. À partir du dernier jour, chaque personne
-- découvre les missions dont elle a été la cible. Le groupe ne voit que le nombre de missions réussies.
-- La table s'appelle missions_secretes : « secret_missions » est une ancienne table de Saraillon.
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Table
create table if not exists public.missions_secretes (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null,
  user_id uuid not null,
  cible_id uuid not null,
  jour date not null,
  type text not null check (type in ('info', 'action')),
  texte text not null,
  reponse text check (reponse is null or char_length(reponse) <= 500),
  photo_chemin text,
  faite boolean not null default false,
  faite_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (sejour_id, user_id, jour),
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

-- 2. Fonctions utiles
-- Date du jour à l'heure française.
create or replace function public.aujourdhui_paris() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- Le séjour est-il arrivé à son dernier jour ?
create or replace function public.sejour_termine(p_sejour uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.fin <= public.aujourdhui_paris() from public.sejours s where s.id = p_sejour), false);
$$;

-- Mission du jour : la crée au premier appel (cible et mission tirées au sort), puis la renvoie.
create or replace function public.ma_mission_du_jour(p_sejour uuid)
returns setof public.missions_secretes
language plpgsql security definer set search_path = '' as $$
declare
  v_moi uuid := auth.uid();
  v_jour date := public.aujourdhui_paris();
  v_s public.sejours;
  v_cible uuid;
  v_prenom text;
  v_type text;
  v_modele text;
  v_infos text[] := array[
    'Découvre le dernier livre ou film que {cible} a adoré.',
    'Découvre un voyage dont {cible} rêve sans l''avoir encore fait.',
    'Découvre un plat que {cible} refuserait de manger, même affamé ou affamée.',
    'Découvre ce qui rendrait {cible} vraiment heureux ou heureuse aujourd''hui.',
    'Découvre la chanson que {cible} écoute en boucle en ce moment.',
    'Découvre un talent caché de {cible}.',
    'Découvre le meilleur souvenir de vacances de {cible}.',
    'Découvre le premier métier dont {cible} rêvait enfant.'];
  v_actions text[] := array[
    'Prépare le café ou le thé de {cible}, sans qu''on te le demande.',
    'Fais un compliment sincère et discret à {cible}.',
    'Trouve un petit geste pour rendre la journée de {cible} plus douce.',
    'Laisse un petit mot gentil quelque part pour {cible}.',
    'Fais rire {cible} aux éclats.',
    'Prends une belle photo de {cible} sans qu''il ou elle s''en rende compte.'];
begin
  if not public.est_membre(p_sejour) then raise exception 'Tu ne fais pas partie de ce séjour.'; end if;
  select * into v_s from public.sejours where id = p_sejour;
  if v_s.debut is not null and v_jour < v_s.debut then return; end if;
  if v_s.fin is not null and v_jour > v_s.fin then return; end if;

  if not exists (select 1 from public.missions_secretes where sejour_id = p_sejour and user_id = v_moi and jour = v_jour) then
    select m.user_id, m.prenom into v_cible, v_prenom from public.sejour_membres m
     where m.sejour_id = p_sejour and m.user_id <> v_moi order by random() limit 1;
    if v_cible is null then return; end if;  -- seul dans le séjour : pas de mission
    v_type := case when random() < 0.5 then 'info' else 'action' end;
    v_modele := case when v_type = 'info' then v_infos[1 + floor(random() * array_length(v_infos, 1))::int]
                     else v_actions[1 + floor(random() * array_length(v_actions, 1))::int] end;
    insert into public.missions_secretes (sejour_id, user_id, cible_id, jour, type, texte)
    values (p_sejour, v_moi, v_cible, v_jour, v_type, replace(v_modele, '{cible}', v_prenom))
    on conflict (sejour_id, user_id, jour) do nothing;
  end if;
  return query select * from public.missions_secretes where sejour_id = p_sejour and user_id = v_moi and jour = v_jour;
end $$;

-- Nombre de missions réussies par personne : seul ce total est visible du groupe.
create or replace function public.missions_reussies(p_sejour uuid)
returns table (user_id uuid, reussies bigint)
language sql stable security definer set search_path = '' as $$
  select m.user_id, count(*) from public.missions_secretes m
   where m.sejour_id = p_sejour and m.faite and public.est_membre(p_sejour)
   group by m.user_id;
$$;

-- On ne peut que compléter sa mission : le reste est figé.
create or replace function public.missions_controle() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.sejour_id := old.sejour_id; new.user_id := old.user_id; new.cible_id := old.cible_id;
  new.jour := old.jour; new.type := old.type; new.texte := old.texte;
  new.faite_le := case when new.faite and not old.faite then now() when not new.faite then null else old.faite_le end;
  return new;
end $$;
drop trigger if exists missions_controle on public.missions_secretes;
create trigger missions_controle before update on public.missions_secretes
  for each row execute function public.missions_controle();

-- 3. Règles d'accès
alter table public.missions_secretes enable row level security;
drop policy if exists "ma mission, ou les missions sur moi une fois le sejour fini" on public.missions_secretes;
create policy "ma mission, ou les missions sur moi une fois le sejour fini" on public.missions_secretes
  for select to authenticated using (
    user_id = (select auth.uid())
    or (cible_id = (select auth.uid()) and faite and public.sejour_termine(sejour_id)));
drop policy if exists "je complete ma mission" on public.missions_secretes;
create policy "je complete ma mission" on public.missions_secretes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.missions_secretes from anon, authenticated;
grant select on public.missions_secretes to authenticated;
grant update (reponse, photo_chemin, faite) on public.missions_secretes to authenticated;
revoke execute on function public.ma_mission_du_jour(uuid), public.missions_reussies(uuid), public.sejour_termine(uuid) from public, anon;
grant execute on function public.ma_mission_du_jour(uuid), public.missions_reussies(uuid), public.sejour_termine(uuid) to authenticated;
revoke execute on function public.missions_controle() from public, anon, authenticated;

-- 4. Photos de preuve : espace de stockage privé, 10 Mo maximum.
--    Visibles par leur auteur, et par la cible une fois le séjour fini (mêmes règles que la mission).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planya-missions', 'planya-missions', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "planya missions : voir" on storage.objects;
create policy "planya missions : voir" on storage.objects
  for select to authenticated using (
    bucket_id = 'planya-missions'
    and exists (select 1 from public.missions_secretes m where m.photo_chemin = name));
drop policy if exists "planya missions : deposer" on storage.objects;
create policy "planya missions : deposer" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'planya-missions' and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.est_membre(((storage.foldername(name))[1])::uuid));
drop policy if exists "planya missions : effacer" on storage.objects;
create policy "planya missions : effacer" on storage.objects
  for delete to authenticated using (
    bucket_id = 'planya-missions' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- 5. Vérification : doit afficher 1 table protégée, 2 règles et 3 règles de stockage.
select
  (select count(*) from pg_class where relname = 'missions_secretes' and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'missions_secretes') as regles,
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'planya missions%') as regles_stockage;

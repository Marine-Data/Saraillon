-- Planya — planning du séjour : activités, choses à apporter, inscriptions, commentaires.
-- Tout est cloisonné par séjour : seules les personnes membres y accèdent.
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Tables
create table if not exists public.activites (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  jour date not null,
  moment text check (moment in ('matin', 'midi', 'apres-midi', 'soir', 'journee')),
  heure time,
  nom text not null check (char_length(trim(nom)) between 1 and 120),
  emoji text check (emoji is null or char_length(emoji) <= 16),
  lieu text check (lieu is null or char_length(lieu) <= 160),
  repas text check (repas in ('petit-dejeuner', 'dejeuner', 'diner', 'apero')),
  notes text check (notes is null or char_length(notes) <= 2000),
  inscription_ouverte boolean not null default false,
  cree_par uuid not null default auth.uid() references auth.users (id) on delete set null,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists activites_sejour_jour_idx on public.activites (sejour_id, jour);

create table if not exists public.activite_apporter (
  id uuid primary key default gen_random_uuid(),
  activite_id uuid not null references public.activites (id) on delete cascade,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  texte text not null check (char_length(trim(texte)) between 1 and 120),
  fait boolean not null default false,
  ordre int not null default 0
);
create index if not exists activite_apporter_act_idx on public.activite_apporter (activite_id);

create table if not exists public.activite_inscriptions (
  activite_id uuid not null references public.activites (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  inscrit_le timestamptz not null default now(),
  primary key (activite_id, user_id)
);

create table if not exists public.activite_commentaires (
  id uuid primary key default gen_random_uuid(),
  activite_id uuid not null references public.activites (id) on delete cascade,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  texte text not null check (char_length(trim(texte)) between 1 and 1000),
  cree_le timestamptz not null default now()
);
create index if not exists activite_commentaires_act_idx on public.activite_commentaires (activite_id);

-- 2. Cohérence : les éléments d'une activité héritent toujours du séjour de l'activité
--    (impossible de les rattacher à un autre séjour en trichant sur sejour_id).
create or replace function public.planning_sejour_de_activite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select a.sejour_id into new.sejour_id from public.activites a where a.id = new.activite_id;
  if new.sejour_id is null then raise exception 'activite inconnue'; end if;
  return new;
end $$;

drop trigger if exists apporter_sejour on public.activite_apporter;
create trigger apporter_sejour before insert or update of activite_id on public.activite_apporter
  for each row execute function public.planning_sejour_de_activite();
drop trigger if exists inscriptions_sejour on public.activite_inscriptions;
create trigger inscriptions_sejour before insert on public.activite_inscriptions
  for each row execute function public.planning_sejour_de_activite();
drop trigger if exists commentaires_sejour on public.activite_commentaires;
create trigger commentaires_sejour before insert on public.activite_commentaires
  for each row execute function public.planning_sejour_de_activite();

-- Date de dernière modification, et auteur figé à la création.
create or replace function public.activites_maj() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  new.cree_par := old.cree_par;
  new.sejour_id := old.sejour_id;
  return new;
end $$;
drop trigger if exists activites_maj on public.activites;
create trigger activites_maj before update on public.activites
  for each row execute function public.activites_maj();

-- 3. Règles d'accès
alter table public.activites enable row level security;
alter table public.activite_apporter enable row level security;
alter table public.activite_inscriptions enable row level security;
alter table public.activite_commentaires enable row level security;

drop policy if exists "membres lisent les activites" on public.activites;
create policy "membres lisent les activites" on public.activites
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres ajoutent des activites" on public.activites;
create policy "membres ajoutent des activites" on public.activites
  for insert to authenticated with check (public.est_membre(sejour_id) and cree_par = (select auth.uid()));
drop policy if exists "membres modifient les activites" on public.activites;
create policy "membres modifient les activites" on public.activites
  for update to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));
drop policy if exists "auteur ou organisation supprime" on public.activites;
create policy "auteur ou organisation supprime" on public.activites
  for delete to authenticated using (cree_par = (select auth.uid()) or public.est_organisateur(sejour_id));

drop policy if exists "membres gerent les choses a apporter" on public.activite_apporter;
create policy "membres gerent les choses a apporter" on public.activite_apporter
  for all to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));

drop policy if exists "membres voient les inscriptions" on public.activite_inscriptions;
create policy "membres voient les inscriptions" on public.activite_inscriptions
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "chacun s'inscrit" on public.activite_inscriptions;
create policy "chacun s'inscrit" on public.activite_inscriptions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and public.est_membre(sejour_id)
    and exists (select 1 from public.activites a where a.id = activite_id and a.inscription_ouverte));
drop policy if exists "chacun se desinscrit" on public.activite_inscriptions;
create policy "chacun se desinscrit" on public.activite_inscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "membres lisent les commentaires" on public.activite_commentaires;
create policy "membres lisent les commentaires" on public.activite_commentaires
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres commentent" on public.activite_commentaires;
create policy "membres commentent" on public.activite_commentaires
  for insert to authenticated with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));
drop policy if exists "auteur ou organisation efface un commentaire" on public.activite_commentaires;
create policy "auteur ou organisation efface un commentaire" on public.activite_commentaires
  for delete to authenticated using (user_id = (select auth.uid()) or public.est_organisateur(sejour_id));

-- 4. Droits : rien pour les visiteurs non connectés.
revoke all on public.activites, public.activite_apporter, public.activite_inscriptions, public.activite_commentaires from anon, authenticated;
grant select, insert, update, delete on public.activites to authenticated;
grant select, insert, update, delete on public.activite_apporter to authenticated;
grant select, insert, delete on public.activite_inscriptions to authenticated;
grant select, insert, delete on public.activite_commentaires to authenticated;
revoke execute on function public.planning_sejour_de_activite(), public.activites_maj() from public, anon, authenticated;

-- 5. Vérification : doit afficher 4 tables protégées et 11 règles.
select
  (select count(*) from pg_class where relname in ('activites', 'activite_apporter', 'activite_inscriptions', 'activite_commentaires') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('activites', 'activite_apporter', 'activite_inscriptions', 'activite_commentaires')) as regles;

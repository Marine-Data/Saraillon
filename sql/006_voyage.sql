-- Planya — voyage : fiche d'infos du séjour, arrivées et départs de chacun, billets privés.
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Fiche d'infos du séjour (une par séjour) : lue et modifiée par tous les membres.
create table if not exists public.fiche_sejour (
  sejour_id uuid primary key references public.sejours (id) on delete cascade,
  adresse text check (adresse is null or char_length(adresse) <= 300),
  acces text check (acces is null or char_length(acces) <= 500),
  wifi text check (wifi is null or char_length(wifi) <= 200),
  contacts text check (contacts is null or char_length(contacts) <= 1000),
  notes text check (notes is null or char_length(notes) <= 2000),
  maj_par uuid default auth.uid(),
  maj_le timestamptz not null default now()
);

-- 2. Arrivée et départ de chaque personne. Rattachés à l'appartenance au séjour :
--    quitter le séjour ou en être retiré efface ses trajets et ses billets.
create table if not exists public.trajets (
  sejour_id uuid not null,
  user_id uuid not null default auth.uid(),
  sens text not null check (sens in ('arrivee', 'depart')),
  jour date,
  heure time,
  lieu text check (lieu is null or char_length(lieu) <= 120),
  note text check (note is null or char_length(note) <= 300),
  maj_le timestamptz not null default now(),
  primary key (sejour_id, user_id, sens),
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

-- 3. Billets : fichiers dans un espace de stockage privé ; seule la personne qui les dépose y accède.
create table if not exists public.billets (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null,
  user_id uuid not null default auth.uid(),
  nom_fichier text not null check (char_length(nom_fichier) between 1 and 200),
  chemin text not null unique,
  cree_le timestamptz not null default now(),
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

-- Date de mise à jour et auteur de la dernière modification de la fiche.
create or replace function public.fiche_sejour_maj() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.maj_le := now();
  new.maj_par := auth.uid();
  if tg_op = 'UPDATE' then new.sejour_id := old.sejour_id; end if;
  return new;
end $$;
drop trigger if exists fiche_sejour_maj on public.fiche_sejour;
create trigger fiche_sejour_maj before insert or update on public.fiche_sejour
  for each row execute function public.fiche_sejour_maj();

-- 4. Règles d'accès
alter table public.fiche_sejour enable row level security;
alter table public.trajets enable row level security;
alter table public.billets enable row level security;

drop policy if exists "membres lisent la fiche" on public.fiche_sejour;
create policy "membres lisent la fiche" on public.fiche_sejour
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres creent la fiche" on public.fiche_sejour;
create policy "membres creent la fiche" on public.fiche_sejour
  for insert to authenticated with check (public.est_membre(sejour_id));
drop policy if exists "membres modifient la fiche" on public.fiche_sejour;
create policy "membres modifient la fiche" on public.fiche_sejour
  for update to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));

drop policy if exists "membres voient les trajets" on public.trajets;
create policy "membres voient les trajets" on public.trajets
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "chacun gere ses trajets" on public.trajets;
create policy "chacun gere ses trajets" on public.trajets
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));

drop policy if exists "chacun voit et gere ses billets" on public.billets;
create policy "chacun voit et gere ses billets" on public.billets
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));

-- 5. Droits : rien pour les visiteurs non connectés.
revoke all on public.fiche_sejour, public.trajets, public.billets from anon, authenticated;
grant select, insert on public.fiche_sejour to authenticated;
grant update (adresse, acces, wifi, contacts, notes) on public.fiche_sejour to authenticated;
grant select, insert, delete on public.trajets to authenticated;
grant update (jour, heure, lieu, note) on public.trajets to authenticated;
grant select, insert, delete on public.billets to authenticated;
revoke execute on function public.fiche_sejour_maj() from public, anon, authenticated;

-- 6. Espace de stockage privé des billets : 10 Mo maximum, PDF et images.
--    Chemin d'un fichier : <séjour>/<personne>/<nom>. Seule la personne y accède.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planya-billets', 'planya-billets', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "planya billets : lire les siens" on storage.objects;
create policy "planya billets : lire les siens" on storage.objects
  for select to authenticated using (
    bucket_id = 'planya-billets' and (storage.foldername(name))[2] = (select auth.uid())::text);
drop policy if exists "planya billets : deposer les siens" on storage.objects;
create policy "planya billets : deposer les siens" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'planya-billets' and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.est_membre(((storage.foldername(name))[1])::uuid));
drop policy if exists "planya billets : effacer les siens" on storage.objects;
create policy "planya billets : effacer les siens" on storage.objects
  for delete to authenticated using (
    bucket_id = 'planya-billets' and (storage.foldername(name))[2] = (select auth.uid())::text);

-- 7. Vérification : doit afficher 3 tables protégées, 6 règles et 3 règles de stockage.
select
  (select count(*) from pg_class where relname in ('fiche_sejour', 'trajets', 'billets') and relrowsecurity and relnamespace = 'public'::regnamespace) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('fiche_sejour', 'trajets', 'billets')) as regles,
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'planya billets%') as regles_stockage;

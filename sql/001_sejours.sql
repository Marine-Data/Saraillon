-- Saraillon — étape 1 : comptes, séjours, invitations.
-- Chaque séjour est cloisonné : seules les personnes membres d'un séjour en voient le contenu.
-- Tables nouvelles, séparées de celles du séjour d'août 2026 (verrouillées, non utilisées ici).
-- À exécuter une fois dans Supabase (projet saraillon) : SQL Editor > New query > coller > Run.

-- 1. Tables
create table if not exists public.sejours (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(trim(nom)) between 1 and 80),
  lieu text check (lieu is null or char_length(lieu) <= 120),
  debut date,
  fin date,
  code_invitation text not null unique
    default upper(encode(extensions.gen_random_bytes(4), 'hex')),
  cree_par uuid not null references auth.users (id) on delete cascade,
  cree_le timestamptz not null default now(),
  check (debut is null or fin is null or fin >= debut)
);

create table if not exists public.sejour_membres (
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  prenom text not null check (char_length(trim(prenom)) between 1 and 40),
  role text not null default 'membre' check (role in ('organisateur', 'membre')),
  rejoint_le timestamptz not null default now(),
  primary key (sejour_id, user_id)
);
create index if not exists sejour_membres_user_idx on public.sejour_membres (user_id);

alter table public.sejours enable row level security;
alter table public.sejour_membres enable row level security;

-- 2. Fonctions d'appartenance (évitent que les règles se lisent elles-mêmes en boucle)
create or replace function public.est_membre(p_sejour uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sejour_membres m
                  where m.sejour_id = p_sejour and m.user_id = (select auth.uid()));
$$;

create or replace function public.est_organisateur(p_sejour uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sejour_membres m
                  where m.sejour_id = p_sejour and m.user_id = (select auth.uid())
                    and m.role = 'organisateur');
$$;

-- 3. Règles d'accès
drop policy if exists "membres lisent leur sejour" on public.sejours;
create policy "membres lisent leur sejour" on public.sejours
  for select to authenticated using (public.est_membre(id));

drop policy if exists "organisateurs modifient le sejour" on public.sejours;
create policy "organisateurs modifient le sejour" on public.sejours
  for update to authenticated using (public.est_organisateur(id)) with check (public.est_organisateur(id));

drop policy if exists "organisateurs suppriment le sejour" on public.sejours;
create policy "organisateurs suppriment le sejour" on public.sejours
  for delete to authenticated using (public.est_organisateur(id));

drop policy if exists "membres voient les membres" on public.sejour_membres;
create policy "membres voient les membres" on public.sejour_membres
  for select to authenticated using (public.est_membre(sejour_id));

drop policy if exists "chacun change son prenom" on public.sejour_membres;
create policy "chacun change son prenom" on public.sejour_membres
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "quitter ou retirer un membre" on public.sejour_membres;
create policy "quitter ou retirer un membre" on public.sejour_membres
  for delete to authenticated
  using (role = 'membre' and (user_id = (select auth.uid()) or public.est_organisateur(sejour_id)));

-- Droits : rien pour les visiteurs non connectés ; colonnes modifiables limitées.
revoke all on public.sejours, public.sejour_membres from anon, authenticated;
grant select, delete on public.sejours to authenticated;
grant update (nom, lieu, debut, fin) on public.sejours to authenticated;
grant select, delete on public.sejour_membres to authenticated;
grant update (prenom) on public.sejour_membres to authenticated;

-- 4. Actions passant par la base
-- Créer un séjour : la personne qui le crée en devient organisatrice.
create or replace function public.creer_sejour(p_nom text, p_lieu text, p_debut date, p_fin date, p_prenom text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'connexion requise' using errcode = '28000'; end if;
  insert into public.sejours (nom, lieu, debut, fin, cree_par)
  values (trim(p_nom), nullif(trim(p_lieu), ''), p_debut, p_fin, v_user)
  returning id into v_id;
  insert into public.sejour_membres (sejour_id, user_id, prenom, role)
  values (v_id, v_user, trim(p_prenom), 'organisateur');
  return v_id;
end $$;

-- Rejoindre avec un code d'invitation (ralenti pour limiter les essais en série).
create or replace function public.rejoindre_sejour(p_code text, p_prenom text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'connexion requise' using errcode = '28000'; end if;
  perform pg_sleep(0.3);
  select id into v_id from public.sejours where code_invitation = upper(trim(p_code));
  if v_id is null then return null; end if;
  insert into public.sejour_membres (sejour_id, user_id, prenom)
  values (v_id, v_user, trim(p_prenom))
  on conflict (sejour_id, user_id) do nothing;
  return v_id;
end $$;

-- Nouveau code d'invitation (l'ancien cesse de fonctionner).
create or replace function public.nouveau_code_invitation(p_sejour uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.est_organisateur(p_sejour) then raise exception 'reserve aux organisateurs' using errcode = '42501'; end if;
  update public.sejours set code_invitation = upper(encode(extensions.gen_random_bytes(4), 'hex'))
   where id = p_sejour returning code_invitation into v_code;
  return v_code;
end $$;

revoke execute on function public.est_membre(uuid), public.est_organisateur(uuid),
  public.creer_sejour(text, text, date, date, text), public.rejoindre_sejour(text, text),
  public.nouveau_code_invitation(uuid) from public, anon;
grant execute on function public.est_membre(uuid), public.est_organisateur(uuid),
  public.creer_sejour(text, text, date, date, text), public.rejoindre_sejour(text, text),
  public.nouveau_code_invitation(uuid) to authenticated;

-- 5. Vérification : doit afficher 2 tables protégées et 6 règles.
select
  (select count(*) from pg_class where relname in ('sejours', 'sejour_membres') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('sejours', 'sejour_membres')) as regles;

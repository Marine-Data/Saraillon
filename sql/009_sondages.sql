-- Planya — sondages : une question, 2 à 6 choix, un vote par personne (modifiable), clôture facultative.
-- Votes anonymes ou visibles, au choix de la personne qui crée le sondage.
-- Vote anonyme = anonyme aussi dans la base : aucun membre ne peut lire qui a voté quoi,
-- seuls les totaux sont fournis (fonction resultats_sondages).
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Tables
create table if not exists public.sondages (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  question text not null check (char_length(trim(question)) between 1 and 200),
  anonyme boolean not null default true,
  cloture timestamptz,
  cree_par uuid not null default auth.uid(),
  cree_le timestamptz not null default now()
);
create index if not exists sondages_sejour_idx on public.sondages (sejour_id);

create table if not exists public.sondage_choix (
  id uuid primary key default gen_random_uuid(),
  sondage_id uuid not null references public.sondages (id) on delete cascade,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  texte text not null check (char_length(trim(texte)) between 1 and 120),
  ordre int not null default 0
);
create index if not exists sondage_choix_sondage_idx on public.sondage_choix (sondage_id);

create table if not exists public.sondage_votes (
  sondage_id uuid not null references public.sondages (id) on delete cascade,
  user_id uuid not null,
  choix_id uuid not null references public.sondage_choix (id) on delete cascade,
  sejour_id uuid not null,
  vote_le timestamptz not null default now(),
  primary key (sondage_id, user_id),
  -- Quitter le séjour retire ses votes.
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

-- 2. Fonctions
create or replace function public.sondage_clos(p_cloture timestamptz) returns boolean
language sql stable set search_path = '' as $$ select p_cloture is not null and p_cloture <= now() $$;

-- Création en une seule opération (question + choix).
create or replace function public.creer_sondage(p_sejour uuid, p_question text, p_anonyme boolean,
  p_cloture timestamptz, p_choix text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_choix text[];
begin
  if not public.est_membre(p_sejour) then raise exception 'Tu ne fais pas partie de ce séjour.'; end if;
  select array_agg(c order by o) into v_choix
    from (select distinct on (lower(btrim(c))) btrim(c) c, o from unnest(p_choix) with ordinality t(c, o)
          where btrim(c) <> '' order by lower(btrim(c)), o) x;
  if coalesce(array_length(v_choix, 1), 0) not between 2 and 6 then
    raise exception 'Il faut entre 2 et 6 choix différents.';
  end if;
  insert into public.sondages (sejour_id, question, anonyme, cloture, cree_par)
  values (p_sejour, btrim(p_question), coalesce(p_anonyme, true), p_cloture, auth.uid()) returning id into v_id;
  insert into public.sondage_choix (sondage_id, sejour_id, texte, ordre)
  select v_id, p_sejour, c, o::int from unnest(v_choix) with ordinality t(c, o);
  return v_id;
end $$;

-- Voter (ou changer son vote) tant que le sondage est ouvert.
create or replace function public.voter(p_choix uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.sondages;
begin
  select s.* into v_s from public.sondages s join public.sondage_choix c on c.sondage_id = s.id where c.id = p_choix;
  if v_s.id is null or not public.est_membre(v_s.sejour_id) then raise exception 'Sondage introuvable.'; end if;
  if public.sondage_clos(v_s.cloture) then raise exception 'Ce sondage est terminé.'; end if;
  insert into public.sondage_votes (sondage_id, user_id, choix_id, sejour_id)
  values (v_s.id, auth.uid(), p_choix, v_s.sejour_id)
  on conflict (sondage_id, user_id) do update set choix_id = excluded.choix_id, vote_le = now();
end $$;

-- Retirer son vote tant que le sondage est ouvert.
create or replace function public.retirer_vote(p_sondage uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.sondages where id = p_sondage and public.sondage_clos(cloture)) then
    raise exception 'Ce sondage est terminé.';
  end if;
  delete from public.sondage_votes where sondage_id = p_sondage and user_id = auth.uid();
end $$;

-- Totaux par choix, pour tous les sondages du séjour (sans révéler qui a voté).
create or replace function public.resultats_sondages(p_sejour uuid)
returns table (choix_id uuid, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.choix_id, count(*) from public.sondage_votes v
   where v.sejour_id = p_sejour and public.est_membre(p_sejour) group by v.choix_id;
$$;

-- 3. Règles d'accès
alter table public.sondages enable row level security;
alter table public.sondage_choix enable row level security;
alter table public.sondage_votes enable row level security;

drop policy if exists "membres lisent les sondages" on public.sondages;
create policy "membres lisent les sondages" on public.sondages
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "auteur ou organisation clot ou supprime" on public.sondages;
create policy "auteur ou organisation clot ou supprime" on public.sondages
  for update to authenticated using (cree_par = (select auth.uid()) or public.est_organisateur(sejour_id))
  with check (cree_par = (select auth.uid()) or public.est_organisateur(sejour_id));
drop policy if exists "auteur ou organisation supprime le sondage" on public.sondages;
create policy "auteur ou organisation supprime le sondage" on public.sondages
  for delete to authenticated using (cree_par = (select auth.uid()) or public.est_organisateur(sejour_id));

drop policy if exists "membres lisent les choix" on public.sondage_choix;
create policy "membres lisent les choix" on public.sondage_choix
  for select to authenticated using (public.est_membre(sejour_id));

-- Mes votes toujours ; ceux des autres seulement si le sondage n'est pas anonyme.
drop policy if exists "votes visibles selon le sondage" on public.sondage_votes;
create policy "votes visibles selon le sondage" on public.sondage_votes
  for select to authenticated using (
    user_id = (select auth.uid())
    or (public.est_membre(sejour_id)
        and exists (select 1 from public.sondages s where s.id = sondage_id and not s.anonyme)));

-- 4. Droits : écriture des choix et des votes uniquement par les fonctions ci-dessus.
revoke all on public.sondages, public.sondage_choix, public.sondage_votes from anon, authenticated;
grant select, delete on public.sondages to authenticated;
grant update (cloture) on public.sondages to authenticated;
grant select on public.sondage_choix, public.sondage_votes to authenticated;
revoke execute on function public.creer_sondage(uuid, text, boolean, timestamptz, text[]), public.voter(uuid),
  public.retirer_vote(uuid), public.resultats_sondages(uuid) from public, anon;
grant execute on function public.creer_sondage(uuid, text, boolean, timestamptz, text[]), public.voter(uuid),
  public.retirer_vote(uuid), public.resultats_sondages(uuid) to authenticated;

-- 5. Vérification : doit afficher 3 tables protégées et 5 règles.
select
  (select count(*) from pg_class where relname in ('sondages', 'sondage_choix', 'sondage_votes') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('sondages', 'sondage_choix', 'sondage_votes')) as regles;

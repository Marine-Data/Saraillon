-- Planya — liste de courses partagée, avec lien facultatif vers un repas du planning.
-- Prérequis : sql/001_sejours.sql et sql/002_planning.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Table
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  texte text not null check (char_length(trim(texte)) between 1 and 120),
  activite_id uuid references public.activites (id) on delete set null,
  fait boolean not null default false,
  pris_par uuid,
  cree_par uuid not null default auth.uid(),
  cree_le timestamptz not null default now()
);
create index if not exists courses_sejour_idx on public.courses (sejour_id);
create index if not exists courses_activite_idx on public.courses (activite_id);

-- 2. Cohérence :
--    - le repas lié appartient forcément au même séjour ;
--    - « Je m'en occupe » : on ne peut se l'attribuer qu'à soi-même (ou le libérer) ;
--    - l'auteur et le séjour ne changent pas.
create or replace function public.courses_controle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.sejour_id := old.sejour_id;
    new.cree_par := old.cree_par;
  end if;
  if new.activite_id is not null and not exists (
    select 1 from public.activites a where a.id = new.activite_id and a.sejour_id = new.sejour_id) then
    raise exception 'Ce repas ne fait pas partie du séjour.';
  end if;
  if new.pris_par is not null and new.pris_par is distinct from (case when tg_op = 'UPDATE' then old.pris_par end)
     and new.pris_par <> auth.uid() then
    raise exception 'Tu ne peux te charger d''un article que pour toi-même.';
  end if;
  return new;
end $$;
drop trigger if exists courses_controle on public.courses;
create trigger courses_controle before insert or update on public.courses
  for each row execute function public.courses_controle();

-- 3. Règles d'accès : tous les membres du séjour gèrent la liste.
alter table public.courses enable row level security;
drop policy if exists "membres lisent les courses" on public.courses;
create policy "membres lisent les courses" on public.courses
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres ajoutent des courses" on public.courses;
create policy "membres ajoutent des courses" on public.courses
  for insert to authenticated with check (public.est_membre(sejour_id) and cree_par = (select auth.uid()));
drop policy if exists "membres modifient les courses" on public.courses;
create policy "membres modifient les courses" on public.courses
  for update to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));
drop policy if exists "membres suppriment des courses" on public.courses;
create policy "membres suppriment des courses" on public.courses
  for delete to authenticated using (public.est_membre(sejour_id));

-- 4. Droits : rien pour les visiteurs non connectés.
revoke all on public.courses from anon, authenticated;
grant select, insert, delete on public.courses to authenticated;
grant update (texte, activite_id, fait, pris_par) on public.courses to authenticated;
revoke execute on function public.courses_controle() from public, anon, authenticated;

-- 5. Vérification : doit afficher 1 table protégée et 4 règles.
select
  (select count(*) from pg_class where relname = 'courses' and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'courses') as regles;

-- Planya — corvées : la liste du groupe, et qui fait quoi chaque jour (tirage au sort ou choix manuel).
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Tables
create table if not exists public.corvees (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  nom text not null check (char_length(trim(nom)) between 1 and 80),
  ordre int not null default 0,
  cree_le timestamptz not null default now()
);
create index if not exists corvees_sejour_idx on public.corvees (sejour_id);

-- Une corvée, un jour, une personne au plus.
create table if not exists public.corvee_attributions (
  corvee_id uuid not null references public.corvees (id) on delete cascade,
  jour date not null,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  user_id uuid,
  fait boolean not null default false,
  maj_le timestamptz not null default now(),
  primary key (corvee_id, jour)
);
create index if not exists corvee_attributions_sejour_idx on public.corvee_attributions (sejour_id, jour);

-- 2. Cohérence : l'attribution hérite du séjour de la corvée, et la personne fait partie du séjour.
create or replace function public.corvee_attribution_controle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select c.sejour_id into new.sejour_id from public.corvees c where c.id = new.corvee_id;
  if new.sejour_id is null then raise exception 'Corvée inconnue.'; end if;
  if new.user_id is not null and not exists (
    select 1 from public.sejour_membres m where m.sejour_id = new.sejour_id and m.user_id = new.user_id) then
    raise exception 'Cette personne ne fait pas partie du séjour.';
  end if;
  new.maj_le := now();
  return new;
end $$;
drop trigger if exists corvee_attribution_controle on public.corvee_attributions;
create trigger corvee_attribution_controle before insert or update on public.corvee_attributions
  for each row execute function public.corvee_attribution_controle();

-- 3. Tirage du jour enregistré en une fois : remplace les attributions de ce jour
--    (sauf les corvées déjà faites).
create or replace function public.enregistrer_tirage(p_sejour uuid, p_jour date, p_attributions jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.est_membre(p_sejour) then raise exception 'Tu ne fais pas partie de ce séjour.'; end if;
  if jsonb_typeof(p_attributions) <> 'array' then raise exception 'Tirage invalide.'; end if;
  if exists (select 1 from jsonb_array_elements(p_attributions) x
             where not exists (select 1 from public.corvees c where c.id = (x->>'corvee_id')::uuid and c.sejour_id = p_sejour)) then
    raise exception 'Une corvée ne fait pas partie du séjour.';
  end if;
  delete from public.corvee_attributions where sejour_id = p_sejour and jour = p_jour and not fait;
  insert into public.corvee_attributions (corvee_id, jour, sejour_id, user_id)
  select (x->>'corvee_id')::uuid, p_jour, p_sejour, nullif(x->>'user_id', '')::uuid
  from jsonb_array_elements(p_attributions) x
  on conflict (corvee_id, jour) do nothing;
end $$;

-- 4. Règles d'accès : tous les membres du séjour gèrent la liste et les attributions.
alter table public.corvees enable row level security;
alter table public.corvee_attributions enable row level security;

drop policy if exists "membres gerent les corvees" on public.corvees;
create policy "membres gerent les corvees" on public.corvees
  for all to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));
drop policy if exists "membres gerent les attributions" on public.corvee_attributions;
create policy "membres gerent les attributions" on public.corvee_attributions
  for all to authenticated using (public.est_membre(sejour_id)) with check (public.est_membre(sejour_id));

-- 5. Droits : rien pour les visiteurs non connectés.
revoke all on public.corvees, public.corvee_attributions from anon, authenticated;
grant select, insert, delete on public.corvees to authenticated;
grant update (nom, ordre) on public.corvees to authenticated;
grant select, insert, delete on public.corvee_attributions to authenticated;
grant update (corvee_id, jour, user_id, fait) on public.corvee_attributions to authenticated;
revoke execute on function public.corvee_attribution_controle() from public, anon, authenticated;
revoke execute on function public.enregistrer_tirage(uuid, date, jsonb) from public, anon;
grant execute on function public.enregistrer_tirage(uuid, date, jsonb) to authenticated;

-- 6. Vérification : doit afficher 2 tables protégées et 2 règles.
select
  (select count(*) from pg_class where relname in ('corvees', 'corvee_attributions') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('corvees', 'corvee_attributions')) as regles;

-- Planya — dépenses partagées : qui a payé quoi, qui doit combien à qui, remboursements.
-- Montants en centimes (entiers) : aucun arrondi flottant.
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Tables
create table if not exists public.depenses (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  type text not null default 'depense' check (type in ('depense', 'remboursement')),
  description text check (description is null or char_length(description) <= 120),
  montant_centimes int not null check (montant_centimes between 1 and 100000000),
  paye_par uuid not null,
  jour date not null default current_date,
  cree_par uuid not null default auth.uid(),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists depenses_sejour_idx on public.depenses (sejour_id, jour);

-- Part de chaque personne concernée ; la somme des parts égale toujours le montant.
create table if not exists public.depense_parts (
  depense_id uuid not null references public.depenses (id) on delete cascade,
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  user_id uuid not null,
  part_centimes int not null check (part_centimes >= 0),
  primary key (depense_id, user_id)
);

-- 2. Enregistrement (ajout ou modification) en une seule opération vérifiée par la base :
--    la personne est membre, le payeur et chaque personne concernée sont membres,
--    et la somme des parts est exactement égale au montant.
create or replace function public.enregistrer_depense(
  p_sejour uuid, p_id uuid, p_type text, p_description text, p_montant int,
  p_paye_par uuid, p_jour date, p_parts jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_total bigint;
  v_nb int;
begin
  if not public.est_membre(p_sejour) then raise exception 'Tu ne fais pas partie de ce séjour.'; end if;
  if p_montant is null or p_montant < 1 then raise exception 'Le montant doit être positif.'; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'Choisis au moins une personne concernée.';
  end if;
  if not exists (select 1 from public.sejour_membres where sejour_id = p_sejour and user_id = p_paye_par) then
    raise exception 'La personne qui a payé ne fait pas partie du séjour.';
  end if;
  select coalesce(sum((x->>'part')::bigint), 0), count(*) into v_total, v_nb from jsonb_array_elements(p_parts) x;
  if exists (select 1 from jsonb_array_elements(p_parts) x where (x->>'part')::int < 0) then
    raise exception 'Une part ne peut pas être négative.';
  end if;
  if v_total <> p_montant then raise exception 'La somme des parts ne correspond pas au montant.'; end if;
  if (select count(distinct x->>'user_id') from jsonb_array_elements(p_parts) x) <> v_nb
     or exists (select 1 from jsonb_array_elements(p_parts) x
                where not exists (select 1 from public.sejour_membres m
                                  where m.sejour_id = p_sejour and m.user_id = (x->>'user_id')::uuid)) then
    raise exception 'Chaque personne concernée doit faire partie du séjour, une seule fois.';
  end if;

  if v_id is null then
    insert into public.depenses (sejour_id, type, description, montant_centimes, paye_par, jour, cree_par)
    values (p_sejour, coalesce(p_type, 'depense'), nullif(trim(p_description), ''), p_montant, p_paye_par,
            coalesce(p_jour, current_date), auth.uid())
    returning id into v_id;
  else
    update public.depenses
       set type = coalesce(p_type, type), description = nullif(trim(p_description), ''),
           montant_centimes = p_montant, paye_par = p_paye_par, jour = coalesce(p_jour, jour), maj_le = now()
     where id = v_id and sejour_id = p_sejour;
    if not found then raise exception 'Dépense introuvable.'; end if;
    delete from public.depense_parts where depense_id = v_id;
  end if;

  insert into public.depense_parts (depense_id, sejour_id, user_id, part_centimes)
  select v_id, p_sejour, (x->>'user_id')::uuid, (x->>'part')::int from jsonb_array_elements(p_parts) x;
  return v_id;
end $$;

-- 3. Règles d'accès : les membres lisent et suppriment ; ajout et modification
--    uniquement par la fonction ci-dessus (pas d'écriture directe dans les tables).
alter table public.depenses enable row level security;
alter table public.depense_parts enable row level security;

drop policy if exists "membres lisent les depenses" on public.depenses;
create policy "membres lisent les depenses" on public.depenses
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres suppriment les depenses" on public.depenses;
create policy "membres suppriment les depenses" on public.depenses
  for delete to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres lisent les parts" on public.depense_parts;
create policy "membres lisent les parts" on public.depense_parts
  for select to authenticated using (public.est_membre(sejour_id));

-- 4. Droits : rien pour les visiteurs non connectés.
revoke all on public.depenses, public.depense_parts from anon, authenticated;
grant select, delete on public.depenses to authenticated;
grant select on public.depense_parts to authenticated;
revoke execute on function public.enregistrer_depense(uuid, uuid, text, text, int, uuid, date, jsonb) from public, anon;
grant execute on function public.enregistrer_depense(uuid, uuid, text, text, int, uuid, date, jsonb) to authenticated;

-- 5. Vérification : doit afficher 2 tables protégées et 3 règles.
select
  (select count(*) from pg_class where relname in ('depenses', 'depense_parts') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('depenses', 'depense_parts')) as regles;

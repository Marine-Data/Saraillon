-- Planya — valise : liste personnelle et privée.
-- Les « choses à apporter » du planning y apparaissent automatiquement (calculées par l'appli) ;
-- cette table garde ce que chacun a coché et les objets qu'il ajoute pour lui-même.
-- La table s'appelle valise_objets : « checklist_valise » est une ancienne table de Saraillon.
-- Prérequis : sql/001_sejours.sql. À exécuter une fois dans Supabase (projet saraillon).

create table if not exists public.valise_objets (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null,
  user_id uuid not null default auth.uid(),
  texte text not null check (char_length(trim(texte)) between 1 and 120),
  cle text generated always as (lower(btrim(texte))) stored,
  perso boolean not null default true,
  fait boolean not null default false,
  cree_le timestamptz not null default now(),
  unique (sejour_id, user_id, cle),
  -- Quitter le séjour efface sa valise.
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

-- Règles d'accès : la valise de chacun n'est visible que par lui-même.
alter table public.valise_objets enable row level security;
drop policy if exists "chacun sa valise" on public.valise_objets;
create policy "chacun sa valise" on public.valise_objets
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));

revoke all on public.valise_objets from anon, authenticated;
grant select, insert, delete on public.valise_objets to authenticated;
grant update (texte, perso, fait) on public.valise_objets to authenticated;

-- Vérification : doit afficher 1 table protégée et 1 règle.
select
  (select count(*) from pg_class where relname = 'valise_objets' and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'valise_objets') as regles;

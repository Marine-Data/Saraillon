-- Planya — fil d'actu du séjour : événements automatiques + publications, likes et commentaires.
-- Les événements automatiques sont écrits par la base elle-même (déclencheurs) : impossible d'en inventer
-- depuis l'appli. Ils ne contiennent jamais de prénom (affiché au moment de la lecture) ni de secret
-- (une mission réussie est annoncée sans son contenu).
-- Prérequis : sql/001 à 010. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Tables
create table if not exists public.fil_actu (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  user_id uuid default auth.uid(),
  type text not null default 'publication' check (type in ('publication', 'evenement')),
  emoji text,
  texte text not null check (char_length(trim(texte)) between 1 and 1000),
  lien text check (lien in ('planning', 'depenses', 'courses', 'corvees', 'sondages', 'missions')),
  cree_le timestamptz not null default now()
);
create index if not exists fil_actu_sejour_idx on public.fil_actu (sejour_id, cree_le desc);

create table if not exists public.fil_likes (
  entree_id uuid not null references public.fil_actu (id) on delete cascade,
  sejour_id uuid not null,
  user_id uuid not null default auth.uid(),
  primary key (entree_id, user_id),
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);

create table if not exists public.fil_commentaires (
  id uuid primary key default gen_random_uuid(),
  entree_id uuid not null references public.fil_actu (id) on delete cascade,
  sejour_id uuid not null,
  user_id uuid not null default auth.uid(),
  texte text not null check (char_length(trim(texte)) between 1 and 500),
  cree_le timestamptz not null default now(),
  foreign key (sejour_id, user_id) references public.sejour_membres (sejour_id, user_id) on delete cascade
);
create index if not exists fil_commentaires_entree_idx on public.fil_commentaires (entree_id);

-- Les likes et commentaires héritent toujours du séjour de l'entrée.
create or replace function public.fil_sejour_de_entree() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select f.sejour_id into new.sejour_id from public.fil_actu f where f.id = new.entree_id;
  if new.sejour_id is null then raise exception 'Publication introuvable.'; end if;
  return new;
end $$;
drop trigger if exists fil_likes_sejour on public.fil_likes;
create trigger fil_likes_sejour before insert on public.fil_likes
  for each row execute function public.fil_sejour_de_entree();
drop trigger if exists fil_commentaires_sejour on public.fil_commentaires;
create trigger fil_commentaires_sejour before insert on public.fil_commentaires
  for each row execute function public.fil_sejour_de_entree();

-- 2. Événements automatiques
create or replace function public.fil_noter(p_sejour uuid, p_user uuid, p_emoji text, p_texte text, p_lien text)
returns void language sql security definer set search_path = '' as $$
  insert into public.fil_actu (sejour_id, user_id, type, emoji, texte, lien)
  values (p_sejour, p_user, 'evenement', p_emoji, left(p_texte, 1000), p_lien);
$$;

create or replace function public.fil_evenement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_nom text;
begin
  if tg_table_name = 'sejour_membres' then
    if new.role = 'organisateur' then
      perform public.fil_noter(new.sejour_id, new.user_id, '☀️', 'a créé le séjour', null);
    else
      perform public.fil_noter(new.sejour_id, new.user_id, '👋', 'a rejoint le séjour', null);
    end if;
  elsif tg_table_name = 'activites' then
    perform public.fil_noter(new.sejour_id, new.cree_par, '🗓️',
      format('a ajouté l''activité « %s » (%s)', new.nom, to_char(new.jour, 'DD/MM')), 'planning');
  elsif tg_table_name = 'activite_inscriptions' then
    select nom into v_nom from public.activites where id = new.activite_id;
    perform public.fil_noter(new.sejour_id, new.user_id, '✍️', format('participe à « %s »', v_nom), 'planning');
  elsif tg_table_name = 'depenses' then
    if new.type = 'remboursement' then
      perform public.fil_noter(new.sejour_id, new.paye_par, '💸', 'a fait un remboursement', 'depenses');
    else
      perform public.fil_noter(new.sejour_id, new.cree_par, '💰',
        format('a ajouté une dépense « %s » (%s €)', coalesce(new.description, 'dépense'),
               replace(to_char(new.montant_centimes / 100.0, 'FM999999990.00'), '.', ',')), 'depenses');
    end if;
  elsif tg_table_name = 'sondages' then
    perform public.fil_noter(new.sejour_id, new.cree_par, '🗳️', format('a lancé un sondage : « %s »', new.question), 'sondages');
  elsif tg_table_name = 'corvee_attributions' then
    if new.fait and (tg_op = 'INSERT' or not old.fait) then
      select nom into v_nom from public.liste_corvees where id = new.corvee_id;
      perform public.fil_noter(new.sejour_id, coalesce(new.user_id, auth.uid()), '🧹', format('a fait la corvée « %s »', v_nom), 'corvees');
    end if;
  elsif tg_table_name = 'missions_secretes' then
    if new.faite and not old.faite then
      perform public.fil_noter(new.sejour_id, new.user_id, '🕵️', 'a réussi sa mission secrète du jour', 'missions');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists fil_membre on public.sejour_membres;
create trigger fil_membre after insert on public.sejour_membres for each row execute function public.fil_evenement();
drop trigger if exists fil_activite on public.activites;
create trigger fil_activite after insert on public.activites for each row execute function public.fil_evenement();
drop trigger if exists fil_inscription on public.activite_inscriptions;
create trigger fil_inscription after insert on public.activite_inscriptions for each row execute function public.fil_evenement();
drop trigger if exists fil_depense on public.depenses;
create trigger fil_depense after insert on public.depenses for each row execute function public.fil_evenement();
drop trigger if exists fil_sondage on public.sondages;
create trigger fil_sondage after insert on public.sondages for each row execute function public.fil_evenement();
drop trigger if exists fil_corvee on public.corvee_attributions;
create trigger fil_corvee after insert or update of fait on public.corvee_attributions for each row execute function public.fil_evenement();
drop trigger if exists fil_mission on public.missions_secretes;
create trigger fil_mission after update of faite on public.missions_secretes for each row execute function public.fil_evenement();

-- 3. Départ d'un séjour (ou suppression du compte) : ses publications sont effacées,
--    les événements qui le concernent sont anonymisés (« Ancien membre »).
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
  delete from public.fil_actu where sejour_id = old.sejour_id and user_id = old.user_id and type = 'publication';
  update public.fil_actu set user_id = null where sejour_id = old.sejour_id and user_id = old.user_id;
  return old;
end $$;

-- 4. Règles d'accès
alter table public.fil_actu enable row level security;
alter table public.fil_likes enable row level security;
alter table public.fil_commentaires enable row level security;

drop policy if exists "membres lisent le fil" on public.fil_actu;
create policy "membres lisent le fil" on public.fil_actu
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres publient" on public.fil_actu;
create policy "membres publient" on public.fil_actu
  for insert to authenticated with check (
    public.est_membre(sejour_id) and type = 'publication' and user_id = (select auth.uid()) and lien is null);
drop policy if exists "auteur ou organisation efface" on public.fil_actu;
create policy "auteur ou organisation efface" on public.fil_actu
  for delete to authenticated using (
    (type = 'publication' and user_id = (select auth.uid())) or public.est_organisateur(sejour_id));

drop policy if exists "membres voient les likes" on public.fil_likes;
create policy "membres voient les likes" on public.fil_likes
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "chacun ses likes" on public.fil_likes;
create policy "chacun ses likes" on public.fil_likes
  for insert to authenticated with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));
drop policy if exists "chacun retire ses likes" on public.fil_likes;
create policy "chacun retire ses likes" on public.fil_likes
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "membres lisent les commentaires du fil" on public.fil_commentaires;
create policy "membres lisent les commentaires du fil" on public.fil_commentaires
  for select to authenticated using (public.est_membre(sejour_id));
drop policy if exists "membres commentent le fil" on public.fil_commentaires;
create policy "membres commentent le fil" on public.fil_commentaires
  for insert to authenticated with check (user_id = (select auth.uid()) and public.est_membre(sejour_id));
drop policy if exists "auteur ou organisation efface un commentaire du fil" on public.fil_commentaires;
create policy "auteur ou organisation efface un commentaire du fil" on public.fil_commentaires
  for delete to authenticated using (user_id = (select auth.uid()) or public.est_organisateur(sejour_id));

-- 5. Droits : rien pour les visiteurs non connectés ; pas de modification après coup.
revoke all on public.fil_actu, public.fil_likes, public.fil_commentaires from anon, authenticated;
grant select, insert, delete on public.fil_actu, public.fil_likes, public.fil_commentaires to authenticated;
revoke execute on function public.fil_noter(uuid, uuid, text, text, text), public.fil_evenement(),
  public.fil_sejour_de_entree() from public, anon, authenticated;

-- 6. Vérification : doit afficher 3 tables protégées, 9 règles et 7 déclencheurs d'événements.
select
  (select count(*) from pg_class where relname in ('fil_actu', 'fil_likes', 'fil_commentaires') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('fil_actu', 'fil_likes', 'fil_commentaires')) as regles,
  (select count(*) from pg_trigger where tgname in ('fil_membre', 'fil_activite', 'fil_inscription', 'fil_depense', 'fil_sondage', 'fil_corvee', 'fil_mission')) as evenements;

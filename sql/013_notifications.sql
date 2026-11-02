-- Planya — notifications sur le téléphone (Web Push), même appli fermée.
-- La base met les notifications en file d'attente ; la fonction « planya-push » les envoie puis les efface.
-- Les clés d'envoi (VAPID) sont créées par la fonction elle-même et rangées dans le coffre-fort de Supabase
-- (Vault) : la clé privée n'apparaît ni dans le code ni dans ce dépôt.
-- Prérequis : sql/001 à 012. À exécuter une fois dans Supabase (projet saraillon).

-- 1. Appareils abonnés (un par navigateur où la personne a activé les notifications)
create table if not exists public.abonnements_push (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  cree_le timestamptz not null default now()
);
create index if not exists abonnements_push_user_idx on public.abonnements_push (user_id);

-- 2. Réglages : chacun coupe ce qu'il ne veut pas recevoir (tout est activé par défaut)
create table if not exists public.preferences_notifications (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  publications boolean not null default true,
  sondages boolean not null default true,
  activites boolean not null default true,
  depenses boolean not null default true,
  matin boolean not null default true
);

-- 3. File d'attente : invisible depuis l'appli, vidée par la fonction d'envoi
create table if not exists public.notifications_a_envoyer (
  id uuid primary key default gen_random_uuid(),
  sejour_id uuid not null references public.sejours (id) on delete cascade,
  categorie text not null check (categorie in ('publications', 'sondages', 'activites', 'depenses', 'matin')),
  destinataire uuid,           -- une personne précise, ou null = tout le séjour sauf l'auteur
  auteur uuid,
  texte text not null,
  lien text,
  cree_le timestamptz not null default now()
);

alter table public.abonnements_push enable row level security;
alter table public.preferences_notifications enable row level security;
alter table public.notifications_a_envoyer enable row level security;

drop policy if exists "chacun ses appareils" on public.abonnements_push;
create policy "chacun ses appareils" on public.abonnements_push
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "chacun ses reglages" on public.preferences_notifications;
create policy "chacun ses reglages" on public.preferences_notifications
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.abonnements_push, public.preferences_notifications, public.notifications_a_envoyer from anon, authenticated;
grant select, insert, delete on public.abonnements_push to authenticated;
grant update (p256dh, auth) on public.abonnements_push to authenticated;
grant select, insert on public.preferences_notifications to authenticated;
grant update (publications, sondages, activites, depenses, matin) on public.preferences_notifications to authenticated;

-- 4. Clés VAPID dans le coffre-fort : lecture de la clé publique pour les membres,
--    lecture et création des deux clés réservées à la fonction d'envoi (rôle service).
create or replace function public.push_cle_publique() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'planya_vapid_publique';
$$;
create or replace function public.push_cles() returns table (publique text, privee text)
language sql stable security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'planya_vapid_publique'),
         (select decrypted_secret from vault.decrypted_secrets where name = 'planya_vapid_privee');
$$;
create or replace function public.push_enregistrer_cles(p_publique text, p_privee text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name in ('planya_vapid_publique', 'planya_vapid_privee')) then return; end if;
  perform vault.create_secret(p_publique, 'planya_vapid_publique', 'Planya : clé publique Web Push');
  perform vault.create_secret(p_privee, 'planya_vapid_privee', 'Planya : clé privée Web Push');
end $$;
revoke execute on function public.push_cle_publique(), public.push_cles(), public.push_enregistrer_cles(text, text) from public, anon, authenticated;
grant execute on function public.push_cle_publique() to authenticated;
grant execute on function public.push_cles(), public.push_enregistrer_cles(text, text) to service_role;

-- Enregistrer cet appareil pour la personne connectée (un appareil partagé passe au dernier compte connecté).
create or replace function public.enregistrer_appareil(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Appareil invalide.'; end if;
  insert into public.abonnements_push (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, cree_le = now();
end $$;
revoke execute on function public.enregistrer_appareil(text, text, text) from public, anon;
grant execute on function public.enregistrer_appareil(text, text, text) to authenticated;

-- 5. Mise en file + réveil de la fonction d'envoi
create or replace function public.notifier(p_sejour uuid, p_categorie text, p_destinataire uuid, p_auteur uuid, p_texte text, p_lien text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications_a_envoyer (sejour_id, categorie, destinataire, auteur, texte, lien)
  values (p_sejour, p_categorie, p_destinataire, p_auteur, left(p_texte, 200), p_lien);
  perform net.http_post(
    url := 'https://iupghubmnibbdipingnj.supabase.co/functions/v1/planya-push',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb);
end $$;

-- Prénom d'une personne dans un séjour (pour le texte des notifications).
create or replace function public.prenom_dans(p_sejour uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select prenom from public.sejour_membres where sejour_id = p_sejour and user_id = p_user), 'Quelqu''un');
$$;

create or replace function public.notif_evenement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_dep public.depenses;
begin
  if tg_table_name = 'fil_actu' then
    if new.type = 'publication' then
      perform public.notifier(new.sejour_id, 'publications', null, new.user_id,
        format('%s : %s', public.prenom_dans(new.sejour_id, new.user_id), new.texte), 'fil');
    end if;
  elsif tg_table_name = 'sondages' then
    perform public.notifier(new.sejour_id, 'sondages', null, new.cree_par,
      format('🗳️ %s a lancé un sondage : « %s »', public.prenom_dans(new.sejour_id, new.cree_par), new.question), 'sondages');
  elsif tg_table_name = 'activites' then
    perform public.notifier(new.sejour_id, 'activites', null, new.cree_par,
      format('🗓️ %s a ajouté « %s » le %s', public.prenom_dans(new.sejour_id, new.cree_par), new.nom, to_char(new.jour, 'DD/MM')), 'planning');
  elsif tg_table_name = 'depense_parts' then
    select * into v_dep from public.depenses where id = new.depense_id;
    -- Seulement à la création (une dépense modifiée ne renotifie pas), et pas à la personne qui a payé.
    if v_dep.maj_le = v_dep.cree_le and new.user_id <> v_dep.paye_par and new.part_centimes > 0 then
      perform public.notifier(new.sejour_id, 'depenses', new.user_id, v_dep.paye_par,
        case when v_dep.type = 'remboursement'
          then format('💸 %s t''a remboursé %s €', public.prenom_dans(new.sejour_id, v_dep.paye_par),
                      replace(to_char(new.part_centimes / 100.0, 'FM999999990.00'), '.', ','))
          else format('💰 %s a payé « %s » : ta part est de %s €', public.prenom_dans(new.sejour_id, v_dep.paye_par),
                      coalesce(v_dep.description, 'une dépense'), replace(to_char(new.part_centimes / 100.0, 'FM999999990.00'), '.', ','))
        end, 'depenses');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists notif_publication on public.fil_actu;
create trigger notif_publication after insert on public.fil_actu for each row execute function public.notif_evenement();
drop trigger if exists notif_sondage on public.sondages;
create trigger notif_sondage after insert on public.sondages for each row execute function public.notif_evenement();
drop trigger if exists notif_activite on public.activites;
create trigger notif_activite after insert on public.activites for each row execute function public.notif_evenement();
drop trigger if exists notif_depense on public.depense_parts;
create trigger notif_depense after insert on public.depense_parts for each row execute function public.notif_evenement();

-- 6. Notification du matin (8 h 30, heure de Paris) pendant le séjour : corvées du jour et mission secrète.
create or replace function public.notifs_du_matin() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_corvees text;
begin
  for r in
    select m.sejour_id, m.user_id from public.sejour_membres m join public.sejours s on s.id = m.sejour_id
     where public.aujourdhui_paris() between coalesce(s.debut, '-infinity'::date) and coalesce(s.fin, '-infinity'::date)
  loop
    select string_agg(l.nom, ', ' order by l.ordre) into v_corvees
      from public.corvee_attributions c join public.liste_corvees l on l.id = c.corvee_id
     where c.sejour_id = r.sejour_id and c.user_id = r.user_id and c.jour = public.aujourdhui_paris() and not c.fait;
    perform public.notifier(r.sejour_id, 'matin', r.user_id, null,
      case when v_corvees is null then '☀️ Bonjour ! Ta mission secrète du jour t''attend 🕵️'
           else format('☀️ Bonjour ! Aujourd''hui : %s. Et ta mission secrète t''attend 🕵️', v_corvees) end,
      case when v_corvees is null then 'missions' else 'corvees' end);
  end loop;
end $$;
revoke execute on function public.notifier(uuid, text, uuid, uuid, text, text), public.notif_evenement(),
  public.notifs_du_matin(), public.prenom_dans(uuid, uuid) from public, anon, authenticated;

-- Tous les jours à 7 h 30 UTC (8 h 30 l'hiver, 9 h 30 l'été à Paris).
select cron.unschedule('planya-notifs-matin') where exists (select 1 from cron.job where jobname = 'planya-notifs-matin');
select cron.schedule('planya-notifs-matin', '30 7 * * *', $$ select public.notifs_du_matin() $$);

-- 7. Création des clés : un premier appel de la fonction d'envoi les génère si elles n'existent pas.
select net.http_post(url := 'https://iupghubmnibbdipingnj.supabase.co/functions/v1/planya-push',
  headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb);

-- 8. Vérification : doit afficher 3 tables protégées, 2 règles, 4 déclencheurs et 1 tâche du matin.
select
  (select count(*) from pg_class where relname in ('abonnements_push', 'preferences_notifications', 'notifications_a_envoyer') and relrowsecurity) as tables_protegees,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('abonnements_push', 'preferences_notifications')) as regles,
  (select count(*) from pg_trigger where tgname in ('notif_publication', 'notif_sondage', 'notif_activite', 'notif_depense')) as declencheurs,
  (select count(*) from cron.job where jobname = 'planya-notifs-matin') as matin;

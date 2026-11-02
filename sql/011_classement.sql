-- Planya — classement général du séjour, en points (barème repris de Saraillon) :
--   mission secrète réussie : 25 points ; corvée faite : 15 points ;
--   participation à une activité (inscription, une fois le jour de l'activité arrivé) : 10 points.
-- Seuls les totaux sont renvoyés : le détail des missions reste secret.
-- Prérequis : sql/001 à 008. À exécuter une fois dans Supabase (projet saraillon).

create or replace function public.classement_points(p_sejour uuid)
returns table (user_id uuid, prenom text, missions bigint, corvees bigint, activites bigint, points bigint)
language sql stable security definer set search_path = '' as $$
  with compteurs as (
    select m.user_id, m.prenom,
      (select count(*) from public.missions_secretes x
        where x.sejour_id = p_sejour and x.user_id = m.user_id and x.faite) as missions,
      (select count(*) from public.corvee_attributions c
        where c.sejour_id = p_sejour and c.user_id = m.user_id and c.fait) as corvees,
      (select count(*) from public.activite_inscriptions i join public.activites a on a.id = i.activite_id
        where i.sejour_id = p_sejour and i.user_id = m.user_id and a.jour <= public.aujourdhui_paris()) as activites
    from public.sejour_membres m
    where m.sejour_id = p_sejour and public.est_membre(p_sejour)
  )
  select user_id, prenom, missions, corvees, activites,
         missions * 25 + corvees * 15 + activites * 10 as points   -- barème : un seul endroit à modifier
  from compteurs
  order by points desc, prenom;
$$;

revoke execute on function public.classement_points(uuid) from public, anon;
grant execute on function public.classement_points(uuid) to authenticated;

-- Vérification : doit afficher 1.
select count(*) as fonction_classement from pg_proc where proname = 'classement_points';

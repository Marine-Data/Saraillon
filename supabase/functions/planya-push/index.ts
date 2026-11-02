// Planya — envoi des notifications sur les téléphones (Web Push).
// Réveillée par la base à chaque notification mise en file (sql/013_notifications.sql).
// Elle ne prend aucun paramètre : elle vide la file « notifications_a_envoyer », envoie, puis efface.
// L'appeler sans raison ne fait donc rien d'autre que traiter ce que la base a déjà prévu.
// Les clés VAPID sont créées ici au premier appel et rangées dans le Vault : la clé privée
// n'est écrite nulle part ailleurs.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SITE = 'https://marine-data.github.io/planya/';

async function cles() {
  let { data } = await admin.rpc('push_cles');
  if (!data?.[0]?.publique || !data?.[0]?.privee) {
    const k = webpush.generateVAPIDKeys();
    await admin.rpc('push_enregistrer_cles', { p_publique: k.publicKey, p_privee: k.privateKey });
    ({ data } = await admin.rpc('push_cles'));
  }
  return data[0] as { publique: string; privee: string };
}

Deno.serve(async () => {
  const c = await cles();
  webpush.setVapidDetails(SITE, c.publique, c.privee);

  // On « réserve » les notifications en attente en les retirant de la file (rien n'est conservé).
  const { data: file, error } = await admin.from('notifications_a_envoyer')
    .delete().lte('cree_le', new Date().toISOString()).select();
  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });

  let envoyees = 0;
  for (const n of file ?? []) {
    const [{ data: sejour }, { data: membres }] = await Promise.all([
      admin.from('sejours').select('nom').eq('id', n.sejour_id).maybeSingle(),
      admin.from('sejour_membres').select('user_id').eq('sejour_id', n.sejour_id),
    ]);
    const ids = n.destinataire ? [n.destinataire] : (membres ?? []).map(m => m.user_id).filter(id => id !== n.auteur);
    if (!ids.length || !sejour) continue;
    const { data: prefs } = await admin.from('preferences_notifications').select('*').in('user_id', ids);
    const coupe = new Set((prefs ?? []).filter(p => p[n.categorie] === false).map(p => p.user_id));
    const cibles = ids.filter(id => !coupe.has(id));
    if (!cibles.length) continue;
    const { data: appareils } = await admin.from('abonnements_push').select('*').in('user_id', cibles);
    const message = JSON.stringify({
      title: `☀ ${sejour.nom}`,
      body: n.texte,
      url: `./#/sejour/${n.sejour_id}${n.lien ? '/' + n.lien : ''}`,
    });
    await Promise.allSettled((appareils ?? []).map(a =>
      webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, message, { TTL: 86400 })
        .then(() => { envoyees++; })
        .catch(async (e: { statusCode?: number }) => {
          // Appareil désabonné ou expiré : on l'oublie.
          if (e.statusCode === 404 || e.statusCode === 410) await admin.from('abonnements_push').delete().eq('endpoint', a.endpoint);
        })));
  }
  return new Response(JSON.stringify({ traitees: file?.length ?? 0, envoyees }), { headers: { 'Content-Type': 'application/json' } });
});

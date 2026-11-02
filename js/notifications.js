// Planya — notifications sur cet appareil (Web Push) et réglages par type.
// Envoi : fonction « planya-push » (supabase/functions/planya-push) ; règles : sql/013_notifications.sql.
import { sb } from './supabase.js';

export const TYPES = [
  ['publications', 'Publications du fil d’actu'],
  ['sondages', 'Nouveaux sondages'],
  ['activites', 'Nouvelles activités du planning'],
  ['depenses', 'Dépenses et remboursements qui te concernent'],
  ['matin', 'Le matin : tes corvées et ta mission du jour'],
];

export const pushPossible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const estIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function base64VersOctets(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

export async function abonnementActuel() {
  if (!pushPossible()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function activerNotifications() {
  if (!pushPossible()) throw new Error('Ce navigateur ne permet pas les notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur.');
  const { data: cle, error: e1 } = await sb.rpc('push_cle_publique');
  if (e1) throw e1;
  if (!cle) throw new Error('Les notifications ne sont pas encore prêtes : réessaie dans une minute.');
  const reg = await navigator.serviceWorker.ready;
  let abo = await reg.pushManager.getSubscription();
  if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64VersOctets(cle) });
  const j = abo.toJSON();
  const { error } = await sb.rpc('enregistrer_appareil', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) throw error;
}

// Désabonne cet appareil (et l'oublie côté base). Appelé aussi à la déconnexion.
export async function desactiverNotifications() {
  const abo = await abonnementActuel().catch(() => null);
  if (!abo) return;
  await sb.from('abonnements_push').delete().eq('endpoint', abo.endpoint);
  await abo.unsubscribe().catch(() => {});
}

export async function lirePreferences(moi) {
  const { data } = await sb.from('preferences_notifications').select('*').eq('user_id', moi).maybeSingle();
  return Object.fromEntries(TYPES.map(([k]) => [k, data ? data[k] !== false : true]));
}

export async function enregistrerPreference(moi, cle, valeur) {
  const { data } = await sb.from('preferences_notifications').select('user_id').eq('user_id', moi).maybeSingle();
  const { error } = data
    ? await sb.from('preferences_notifications').update({ [cle]: valeur }).eq('user_id', moi)
    : await sb.from('preferences_notifications').insert({ [cle]: valeur });
  if (error) throw error;
}

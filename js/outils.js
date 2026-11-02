// Outils partagés par tous les écrans.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.minuteur); toast.minuteur = setTimeout(() => { t.hidden = true; }, 3500);
}
export function dateFr(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/^1 /, '1er ');
}
export function periode(s) {
  if (s.debut && s.fin) return `du ${dateFr(s.debut)} au ${dateFr(s.fin)}`;
  if (s.debut) return `à partir du ${dateFr(s.debut)}`;
  return '';
}
export function messageErreur(e) {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return 'Confirme d’abord ton adresse : clique sur le lien reçu par e-mail.';
  if (/already registered|already been registered/i.test(m)) return 'Un compte existe déjà avec cette adresse. Connecte-toi.';
  if (/Password should be at least/i.test(m)) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (/rate limit|too many/i.test(m)) return 'Trop d’essais d’affilée : réessaie dans quelques minutes.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de réseau : réessaie dans un instant.';
  return 'Une erreur est survenue : ' + m;
}
// Exécute une action de formulaire en désactivant le bouton pendant l'attente.
export async function pendant(form, action) {
  const bouton = form.querySelector('button[type="submit"]');
  const err = form.querySelector('.erreur');
  if (err) err.textContent = '';
  bouton.disabled = true;
  try { await action(); }
  catch (e) { if (err) err.textContent = messageErreur(e); else toast(messageErreur(e)); }
  finally { bouton.disabled = false; }
}
export const aller = route => { location.hash = route; };
export const adresseRetour = () => location.origin + location.pathname;

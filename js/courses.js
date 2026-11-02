// Planya — liste de courses partagée du séjour.
// Chaque article peut être rattaché à un repas du planning ; « Je m'en occupe » évite les achats en double.
// Règles d'accès : sql/004_courses.sql (membres du séjour uniquement).
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const REPAS = { 'petit-dejeuner': 'Petit-déjeuner', dejeuner: 'Déjeuner', diner: 'Dîner', apero: 'Apéro' };
const RANG_REPAS = { 'petit-dejeuner': 0, dejeuner: 1, apero: 2, diner: 3 };
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
export const titreRepas = a => `${REPAS[a.repas] || 'Repas'} · ${jourCourt(a.jour)} — ${a.nom}`;

async function charger(sejourId) {
  const [s, m, a, c] = await Promise.all([
    sb.from('sejours').select('id, nom').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom').eq('sejour_id', sejourId),
    sb.from('activites').select('id, jour, nom, repas, heure').eq('sejour_id', sejourId).not('repas', 'is', null),
    sb.from('courses').select('*').eq('sejour_id', sejourId).order('cree_le'),
  ]);
  const erreur = s.error || m.error || a.error || c.error;
  if (erreur) throw erreur;
  const repas = (a.data || []).sort((x, y) => x.jour.localeCompare(y.jour) || RANG_REPAS[x.repas] - RANG_REPAS[y.repas]);
  return { sejour: s.data, membres: m.data || [], repas, courses: c.data || [] };
}

// Repas choisi dans le formulaire, gardé d'un ajout à l'autre.
let repasChoisi = '';

export async function ecranCourses(app, sejourId, session, { repasId = null, garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement des courses…</p>';
  let donnees;
  try { donnees = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, repas, courses } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }
  if (repasId) repasChoisi = repasId;
  if (repasChoisi && !repas.some(r => r.id === repasChoisi)) repasChoisi = '';

  const moi = session.user.id;
  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranCourses(app, sejourId, session, { garderPosition: true });
  const aAcheter = courses.filter(c => !c.fait);
  const panier = courses.filter(c => c.fait);

  // Groupes : un par repas qui a des articles à acheter, puis les articles sans repas.
  const groupes = repas.map(r => ({ titre: '🍽️ ' + titreRepas(r), articles: aAcheter.filter(c => c.activite_id === r.id) }))
    .filter(g => g.articles.length);
  const sansRepas = aAcheter.filter(c => !c.activite_id || !repas.some(r => r.id === c.activite_id));
  if (sansRepas.length) groupes.push({ titre: groupes.length ? '🛒 Autres courses' : '', articles: sansRepas });

  const ligne = c => {
    const pris = c.pris_par;
    return `
    <li class="article ${c.fait ? 'fait' : ''}" data-article="${c.id}">
      <label><input type="checkbox" data-cocher ${c.fait ? 'checked' : ''}> <span>${esc(c.texte)}</span></label>
      ${c.fait ? '' : `<button class="puce ${pris === moi ? 'moi' : ''}" data-action="prendre"
        aria-label="${pris ? (pris === moi ? 'Ne plus m’en occuper' : 'Reprendre cet article') : 'Je m’en occupe'}">🙋 ${pris ? esc(prenom(pris)) : 'Je m’en occupe'}</button>`}
      <button class="lien petit danger-lien" data-action="supprimer" aria-label="Supprimer ${esc(c.texte)}">✕</button>
    </li>`;
  };

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Courses</h1>
    <form class="carte" id="formAjout" novalidate>
      <label for="cTexte">Ajouter un article</label>
      <input id="cTexte" name="texte" maxlength="120" placeholder="Ex. : Tomates" autocomplete="off">
      <label for="cRepas">Pour quel repas ? (facultatif)</label>
      <select id="cRepas" name="repas">
        <option value="">Aucun en particulier</option>
        ${repas.map(r => `<option value="${r.id}" ${r.id === repasChoisi ? 'selected' : ''}>${esc(titreRepas(r))}</option>`).join('')}
      </select>
      ${repas.length ? '' : '<p class="info">Pour rattacher un article à un repas, choisis un type de repas sur une activité du planning.</p>'}
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Ajouter</button>
    </form>

    <section class="liste-courses">
      <div class="entete-section"><h2>À acheter (${aAcheter.length})</h2>
        ${aAcheter.length ? '<button class="lien" id="partager">Partager la liste</button>' : ''}</div>
      ${groupes.map(g => `
        ${g.titre ? `<h3 class="groupe">${esc(g.titre)}</h3>` : ''}
        <ul class="liste">${g.articles.map(ligne).join('')}</ul>`).join('') || '<p class="vide">Rien à acheter pour l’instant.</p>'}
      ${panier.length ? `
      <details class="panier">
        <summary>Dans le panier (${panier.length})</summary>
        <ul class="liste">${panier.map(ligne).join('')}</ul>
        <button class="btn secondaire" id="vider">Retirer les articles cochés</button>
      </details>` : ''}
    </section>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  const form = app.querySelector('#formAjout');
  form.repas.onchange = () => { repasChoisi = form.repas.value; };
  if (!garderPosition && repasId) form.texte.focus();
  form.onsubmit = e => {
    e.preventDefault();
    const texte = form.texte.value.trim();
    if (!texte) { form.querySelector('.erreur').textContent = 'Écris le nom de l’article.'; return; }
    pendant(form, async () => {
      const { error } = await sb.from('courses').insert({ sejour_id: sejourId, texte, activite_id: form.repas.value || null });
      if (error) throw error;
      await recharger();
      app.querySelector('#cTexte')?.focus();
    });
  };

  const partager = app.querySelector('#partager');
  if (partager) partager.onclick = async () => {
    const texte = `🛒 Courses du séjour « ${sejour.nom} »\n`
      + groupes.map(g => (g.titre ? `\n${g.titre}\n` : '\n') + g.articles.map(c => `- ${c.texte}${c.pris_par ? ` (${prenom(c.pris_par)})` : ''}`).join('\n')).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Planya', text: texte });
      else { await navigator.clipboard.writeText(texte); toast('Liste copiée.'); }
    } catch (e) { /* partage annulé */ }
  };

  const vider = app.querySelector('#vider');
  if (vider) vider.onclick = async () => {
    if (!confirm(`Retirer les ${panier.length} articles cochés de la liste ?`)) return;
    const { error } = await sb.from('courses').delete().in('id', panier.map(c => c.id));
    if (error) toast(messageErreur(error)); else recharger();
  };

  const liste = app.querySelector('.liste-courses');
  liste.addEventListener('change', async e => {
    const caseCochee = e.target.closest('[data-cocher]');
    if (!caseCochee) return;
    const id = caseCochee.closest('[data-article]').dataset.article;
    const { error } = await sb.from('courses').update({ fait: caseCochee.checked }).eq('id', id);
    if (error) { caseCochee.checked = !caseCochee.checked; toast(messageErreur(error)); } else recharger();
  });
  liste.addEventListener('click', async e => {
    const cible = e.target.closest('[data-action]');
    if (!cible) return;
    const c = courses.find(x => x.id === cible.closest('[data-article]').dataset.article);
    let error = null;
    if (cible.dataset.action === 'prendre') {
      ({ error } = await sb.from('courses').update({ pris_par: c.pris_par === moi ? null : moi }).eq('id', c.id));
    } else if (cible.dataset.action === 'supprimer') {
      ({ error } = await sb.from('courses').delete().eq('id', c.id));
    } else return;
    if (error) toast(messageErreur(error)); else recharger();
  });
}

// Planya — fil d'actu du séjour : événements automatiques (écrits par la base) et publications,
// avec likes et commentaires. Règles d'accès : sql/012_fil.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const LIENS = { planning: '🗓️ Planning', depenses: '💰 Dépenses', courses: '🛒 Courses', corvees: '🧹 Corvées', sondages: '🗳️ Sondages', missions: '🕵️ Missions' };
const FILTRES = [['tout', 'Tout'], ['publication', 'Publications'], ['evenement', 'Activité']];

function quand(iso) {
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400 && d.getDate() === new Date().getDate()) return `aujourd’hui à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function charger(sejourId) {
  const [s, m, f] = await Promise.all([
    sb.from('sejours').select('id, nom').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom, role').eq('sejour_id', sejourId),
    sb.from('fil_actu').select('*, fil_likes(user_id), fil_commentaires(id, user_id, texte, cree_le)')
      .eq('sejour_id', sejourId).order('cree_le', { ascending: false }).limit(150),
  ]);
  const erreur = s.error || m.error || f.error;
  if (erreur) throw erreur;
  return { sejour: s.data, membres: m.data || [], entrees: f.data || [] };
}

const filtreChoisi = new Map();
const commentairesOuverts = new Set();

export async function ecranFil(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement du fil…</p>';
  const moi = session.user.id;
  let d;
  try { d = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, entrees } = d;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const orga = membres.some(m => m.user_id === moi && m.role === 'organisateur');
  const recharger = () => ecranFil(app, sejourId, session, { garderPosition: true });
  const filtre = filtreChoisi.get(sejourId) || 'tout';
  const visibles = entrees.filter(e => filtre === 'tout' || e.type === filtre);

  const carte = e => {
    const aime = e.fil_likes.some(l => l.user_id === moi);
    const coms = [...e.fil_commentaires].sort((a, b) => a.cree_le.localeCompare(b.cree_le));
    const effacable = (e.type === 'publication' && e.user_id === moi) || orga;
    const ouvert = commentairesOuverts.has(e.id);
    return `
    <article class="entree ${e.type}" data-entree="${e.id}">
      <div class="avatar" aria-hidden="true">${e.type === 'evenement' && e.emoji ? e.emoji : esc(prenom(e.user_id).charAt(0).toUpperCase())}</div>
      <div class="entree-corps">
        <p class="entree-tete"><strong>${esc(prenom(e.user_id))}</strong> <span class="meta">${esc(quand(e.cree_le))}</span>
          ${effacable ? `<button class="lien petit danger-lien" data-action="effacer" aria-label="Effacer">✕</button>` : ''}</p>
        <p class="entree-texte">${esc(e.texte)}</p>
        ${e.lien ? `<button class="lien petit" data-aller="${e.lien}">${LIENS[e.lien]} →</button>` : ''}
        <div class="entree-actions">
          <button class="reaction ${aime ? 'actif' : ''}" data-action="aimer" aria-pressed="${aime}">${aime ? '❤️' : '🤍'} ${e.fil_likes.length || ''}</button>
          <button class="reaction" data-action="commentaires" aria-expanded="${ouvert}">💬 ${coms.length || ''}</button>
        </div>
        ${ouvert ? `
        <div class="entree-commentaires">
          ${coms.map(c => `<p class="commentaire"><strong>${esc(prenom(c.user_id))}</strong> ${esc(c.texte)}
            ${c.user_id === moi || orga ? `<button class="lien petit" data-action="effacer-com" data-id="${c.id}" aria-label="Effacer le commentaire">✕</button>` : ''}</p>`).join('')}
          <form class="form-commentaire" novalidate>
            <input name="texte" maxlength="500" placeholder="Commenter" aria-label="Commenter">
            <button class="btn petit" type="submit">Envoyer</button>
          </form>
        </div>` : ''}
      </div>
    </article>`;
  };

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Fil d’actu</h1>
    <form class="carte" id="formPublier" novalidate>
      <label for="publication">Partager avec le groupe</label>
      <textarea id="publication" name="texte" rows="2" maxlength="1000" placeholder="Un moment, une idée, une blague…"></textarea>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Publier</button>
    </form>
    <div class="onglets" role="tablist">${FILTRES.map(([k, v]) => `<button role="tab" data-filtre="${k}" aria-selected="${k === filtre}">${v}</button>`).join('')}</div>
    <div class="fil">${visibles.map(carte).join('') || '<p class="vide">Rien pour l’instant.</p>'}</div>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelectorAll('[data-filtre]').forEach(b => b.onclick = () => { filtreChoisi.set(sejourId, b.dataset.filtre); recharger(); });

  const form = app.querySelector('#formPublier');
  form.onsubmit = e => {
    e.preventDefault();
    const texte = form.texte.value.trim();
    if (!texte) { form.querySelector('.erreur').textContent = 'Écris quelque chose à partager.'; return; }
    pendant(form, async () => {
      const { error } = await sb.from('fil_actu').insert({ sejour_id: sejourId, texte });
      if (error) throw error;
      form.reset();
      recharger();
    });
  };

  const fil = app.querySelector('.fil');
  fil.addEventListener('click', async ev => {
    const lien = ev.target.closest('[data-aller]');
    if (lien) return aller(`#/sejour/${sejourId}/${lien.dataset.aller}`);
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const entree = entrees.find(x => x.id === b.closest('[data-entree]').dataset.entree);
    let error = null;
    if (b.dataset.action === 'commentaires') {
      if (commentairesOuverts.has(entree.id)) commentairesOuverts.delete(entree.id); else commentairesOuverts.add(entree.id);
      recharger();
      return;
    }
    if (b.dataset.action === 'aimer') {
      ({ error } = entree.fil_likes.some(l => l.user_id === moi)
        ? await sb.from('fil_likes').delete().eq('entree_id', entree.id).eq('user_id', moi)
        : await sb.from('fil_likes').insert({ entree_id: entree.id, sejour_id: sejourId }));
    } else if (b.dataset.action === 'effacer') {
      if (!confirm('Effacer cette publication ?')) return;
      ({ error } = await sb.from('fil_actu').delete().eq('id', entree.id));
    } else if (b.dataset.action === 'effacer-com') {
      if (!confirm('Effacer ce commentaire ?')) return;
      ({ error } = await sb.from('fil_commentaires').delete().eq('id', b.dataset.id));
    } else return;
    if (error) toast(messageErreur(error)); else recharger();
  });
  fil.addEventListener('submit', async ev => {
    const f = ev.target.closest('.form-commentaire');
    if (!f) return;
    ev.preventDefault();
    const texte = f.texte.value.trim();
    if (!texte) return;
    const entree_id = f.closest('[data-entree]').dataset.entree;
    await pendant(f, async () => {
      const { error } = await sb.from('fil_commentaires').insert({ entree_id, sejour_id: sejourId, texte });
      if (error) throw error;
      recharger();
    });
  });
}

// Planya — sondages du séjour.
// Une question, 2 à 6 choix, un vote par personne (modifiable tant que le sondage est ouvert).
// Votes anonymes ou visibles, au choix de la personne qui crée le sondage ; en anonyme, la base
// ne fournit que les totaux. Règles d'accès : sql/009_sondages.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const NB_CHOIX = 6;
const dateHeure = iso => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const clos = s => s.cloture && new Date(s.cloture) <= new Date();

async function charger(sejourId) {
  const [se, m, s, c, v, r] = await Promise.all([
    sb.from('sejours').select('id, nom').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom, role').eq('sejour_id', sejourId),
    sb.from('sondages').select('*').eq('sejour_id', sejourId).order('cree_le', { ascending: false }),
    sb.from('sondage_choix').select('*').eq('sejour_id', sejourId).order('ordre'),
    sb.from('sondage_votes').select('sondage_id, user_id, choix_id').eq('sejour_id', sejourId),
    sb.rpc('resultats_sondages', { p_sejour: sejourId }),
  ]);
  const erreur = se.error || m.error || s.error || c.error || v.error || r.error;
  if (erreur) throw erreur;
  return { sejour: se.data, membres: m.data || [], sondages: s.data || [], choix: c.data || [], votes: v.data || [],
    totaux: new Map((r.data || []).map(x => [x.choix_id, Number(x.votes)])) };
}

export async function ecranSondages(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement des sondages…</p>';
  const moi = session.user.id;
  let d;
  try { d = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, sondages, choix, votes, totaux } = d;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const orga = membres.some(m => m.user_id === moi && m.role === 'organisateur');
  const recharger = () => ecranSondages(app, sejourId, session, { garderPosition: true });

  const carte = s => {
    const options = choix.filter(c => c.sondage_id === s.id);
    const total = options.reduce((t, c) => t + (totaux.get(c.id) || 0), 0);
    const monVote = votes.find(v => v.sondage_id === s.id && v.user_id === moi)?.choix_id;
    const fini = clos(s);
    const max = Math.max(0, ...options.map(c => totaux.get(c.id) || 0));
    const gere = s.cree_par === moi || orga;
    return `
    <article class="carte sondage ${fini ? 'clos' : ''}" data-sondage="${s.id}">
      <h2>${esc(s.question)}</h2>
      <p class="meta">Par ${esc(prenom(s.cree_par))} · ${s.anonyme ? '🔒 votes anonymes' : '👀 votes visibles'}</p>
      <ul class="liste choix">${options.map(c => {
        const n = totaux.get(c.id) || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const gagnant = fini && n === max && max > 0;
        const qui = s.anonyme ? [] : votes.filter(v => v.choix_id === c.id).map(v => prenom(v.user_id));
        return `
        <li>
          <button class="choix-bouton ${c.id === monVote ? 'mien' : ''}" data-choix="${c.id}" ${fini ? 'disabled' : ''}
            aria-pressed="${c.id === monVote}">
            <span class="jauge" style="width:${pct}%"></span>
            <span class="choix-texte">${gagnant ? '🏆 ' : ''}${c.id === monVote ? '✅ ' : ''}${esc(c.texte)}</span>
            <span class="choix-total">${pct} % (${n})</span>
          </button>
          ${qui.length ? `<p class="meta qui">${esc(qui.join(', '))}</p>` : ''}
        </li>`;
      }).join('')}</ul>
      <p class="meta">${fini ? `🏁 Terminé · ${total} vote${total > 1 ? 's' : ''}`
        : `${total} vote${total > 1 ? 's' : ''} · touche un choix pour voter${s.cloture ? ` · clôture ${esc(dateHeure(s.cloture))}` : ''}`}</p>
      <div class="actions-activite">
        ${!fini && monVote ? '<button class="lien" data-action="retirer">Retirer mon vote</button>' : ''}
        ${gere && !fini ? '<button class="lien" data-action="clore">Clore maintenant</button>' : ''}
        ${gere ? '<button class="lien danger-lien" data-action="supprimer">Supprimer</button>' : ''}
      </div>
    </article>`;
  };

  const ouverts = sondages.filter(s => !clos(s));
  const termines = sondages.filter(clos);
  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Sondages</h1>
    <button class="btn" id="nouveau">+ Nouveau sondage</button>
    <div class="sondages">
      ${ouverts.map(carte).join('') || (termines.length ? '' : '<p class="vide">Aucun sondage pour l’instant : lance le premier !</p>')}
      ${termines.length ? `<h2 class="sous-titre">Terminés</h2>${termines.map(carte).join('')}` : ''}
    </div>
    <dialog id="dlgSondage"></dialog>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelector('#nouveau').onclick = () => ouvrirFormulaire(app, { sejourId, recharger });

  app.querySelector('.sondages').addEventListener('click', async e => {
    const bouton = e.target.closest('[data-choix], [data-action]');
    if (!bouton || bouton.disabled) return;
    const id = bouton.closest('[data-sondage]').dataset.sondage;
    let error = null;
    if (bouton.dataset.choix) ({ error } = await sb.rpc('voter', { p_choix: bouton.dataset.choix }));
    else if (bouton.dataset.action === 'retirer') ({ error } = await sb.rpc('retirer_vote', { p_sondage: id }));
    else if (bouton.dataset.action === 'clore') {
      if (!confirm('Clore ce sondage ? Plus personne ne pourra voter.')) return;
      ({ error } = await sb.from('sondages').update({ cloture: new Date().toISOString() }).eq('id', id));
    } else if (bouton.dataset.action === 'supprimer') {
      if (!confirm('Supprimer ce sondage et ses votes ?')) return;
      ({ error } = await sb.from('sondages').delete().eq('id', id));
    }
    if (error) toast(messageErreur(error)); else recharger();
  });
}

function ouvrirFormulaire(app, { sejourId, recharger }) {
  const dlg = app.querySelector('#dlgSondage');
  dlg.innerHTML = `
    <form novalidate>
      <h2>Nouveau sondage</h2>
      <label for="sQuestion">Question</label>
      <input id="sQuestion" name="question" maxlength="200" required placeholder="Ex. : On dîne où ce soir ?">
      <fieldset class="partage">
        <legend>Choix (2 minimum)</legend>
        ${Array.from({ length: NB_CHOIX }, (_, i) => `
          <input name="choix" maxlength="120" aria-label="Choix ${i + 1}" placeholder="Choix ${i + 1}${i < 2 ? '' : ' (facultatif)'}" class="champ-choix">`).join('')}
      </fieldset>
      <label for="sCloture">Clôture (facultatif)</label>
      <input id="sCloture" name="cloture" type="datetime-local">
      <label class="case"><input type="checkbox" name="anonyme" checked> Votes anonymes</label>
      <p class="info">Décoché, chacun voit qui a voté quoi.</p>
      <p class="erreur" role="alert"></p>
      <div class="actions-dialogue">
        <button class="btn secondaire" type="button" id="annulerSondage">Annuler</button>
        <button class="btn" type="submit">Lancer</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelector('#annulerSondage').onclick = () => dlg.close();
  form.onsubmit = e => {
    e.preventDefault();
    const err = form.querySelector('.erreur');
    const question = form.question.value.trim();
    const options = [...form.querySelectorAll('[name=choix]')].map(i => i.value.trim()).filter(Boolean);
    const distincts = new Set(options.map(o => o.toLowerCase()));
    if (!question) { err.textContent = 'Écris la question.'; return; }
    if (distincts.size < 2) { err.textContent = 'Il faut au moins deux choix différents.'; return; }
    const cloture = form.cloture.value ? new Date(form.cloture.value) : null;
    if (cloture && cloture <= new Date()) { err.textContent = 'La clôture doit être dans le futur.'; return; }
    pendant(form, async () => {
      const { error } = await sb.rpc('creer_sondage', {
        p_sejour: sejourId, p_question: question, p_anonyme: form.anonyme.checked,
        p_cloture: cloture ? cloture.toISOString() : null, p_choix: options,
      });
      if (error) throw error;
      dlg.close();
      toast('🗳️ Sondage lancé !');
      recharger();
    });
  };
  dlg.showModal();
}

// Planya — ma valise : liste personnelle et privée.
// Les « choses à apporter » de toutes les activités du planning y apparaissent automatiquement, sans doublons ;
// chacun y ajoute aussi ses propres objets. Ce que je coche et ce que j'ajoute n'est visible que par moi.
// Règles d'accès : sql/007_valise.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const cle = t => String(t || '').trim().toLowerCase();
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

async function charger(sejourId, moi) {
  const [s, a, v] = await Promise.all([
    sb.from('sejours').select('id, nom').eq('id', sejourId).maybeSingle(),
    sb.from('activites').select('id, jour, nom, activite_apporter(texte)').eq('sejour_id', sejourId),
    sb.from('valise_objets').select('*').eq('sejour_id', sejourId).eq('user_id', moi).order('cree_le'),
  ]);
  const erreur = s.error || a.error || v.error;
  if (erreur) throw erreur;
  return { sejour: s.data, activites: a.data || [], objets: v.data || [] };
}

// Objets demandés par le planning, regroupés par nom (insensible à la casse et aux espaces).
function objetsDuPlanning(activites) {
  const groupes = new Map();
  [...activites].sort((x, y) => x.jour.localeCompare(y.jour)).forEach(a => a.activite_apporter.forEach(x => {
    const k = cle(x.texte);
    if (!k) return;
    if (!groupes.has(k)) groupes.set(k, { cle: k, texte: x.texte.trim(), sources: [] });
    const source = `${a.nom} (${jourCourt(a.jour)})`;
    if (!groupes.get(k).sources.includes(source)) groupes.get(k).sources.push(source);
  }));
  return [...groupes.values()].sort((x, y) => x.texte.localeCompare(y.texte, 'fr'));
}

export async function ecranValise(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement de ta valise…</p>';
  const moi = session.user.id;
  let donnees;
  try { donnees = await charger(sejourId, moi); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, activites, objets } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const recharger = () => ecranValise(app, sejourId, session, { garderPosition: true });
  const parCle = new Map(objets.map(o => [o.cle, o]));
  const planning = objetsDuPlanning(activites);
  const clesPlanning = new Set(planning.map(p => p.cle));
  const miens = objets.filter(o => o.perso && !clesPlanning.has(o.cle));
  const total = planning.length + miens.length;
  const faits = planning.filter(p => parCle.get(p.cle)?.fait).length + miens.filter(o => o.fait).length;
  const pct = total ? Math.round((faits / total) * 100) : 0;

  const ligne = ({ k, texte, fait, detail, supprimable }) => `
    <li class="article ${fait ? 'fait' : ''}" data-cle="${esc(k)}">
      <label><input type="checkbox" data-cocher ${fait ? 'checked' : ''}>
        <span class="texte-objet"><span>${esc(texte)}</span>${detail ? `<small class="meta">${esc(detail)}</small>` : ''}</span></label>
      ${supprimable ? `<button class="lien petit danger-lien" data-supprimer aria-label="Retirer ${esc(texte)}">✕</button>` : ''}
    </li>`;

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Ma valise</h1>
    <p class="info">🔒 Ta valise n’est visible que par toi.</p>
    ${total ? `
    <section class="carte progression">
      <strong>🎒 ${faits} / ${total} dans la valise</strong>
      <div class="barre" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    </section>` : ''}

    <section class="liste-valise">
      <h2>Pour les activités</h2>
      ${planning.length ? `<ul class="liste">${planning.map(p => ligne({
        k: p.cle, texte: p.texte, fait: parCle.get(p.cle)?.fait,
        detail: p.sources.length > 2 ? `${p.sources.length} activités` : p.sources.join(', '),
      })).join('')}</ul>`
      : '<p class="info">Rien pour l’instant : les « choses à apporter » des activités du planning apparaîtront ici.</p>'}

      <h2 class="sous-titre">Mes objets</h2>
      ${miens.length ? `<ul class="liste">${miens.map(o => ligne({ k: o.cle, texte: o.texte, fait: o.fait, supprimable: true })).join('')}</ul>` : ''}
      <form id="formObjet" class="form-commentaire" novalidate>
        <input name="texte" maxlength="120" placeholder="Ex. : chargeur, lunettes de soleil" aria-label="Ajouter un objet" autocomplete="off">
        <button class="btn petit" type="submit">Ajouter</button>
        <p class="erreur" role="alert"></p>
      </form>
    </section>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);

  const form = app.querySelector('#formObjet');
  form.onsubmit = e => {
    e.preventDefault();
    const texte = form.texte.value.trim();
    if (!texte) { form.querySelector('.erreur').textContent = 'Écris le nom de l’objet.'; return; }
    if (clesPlanning.has(cle(texte)) || parCle.get(cle(texte))?.perso) {
      form.querySelector('.erreur').textContent = 'Cet objet est déjà dans ta liste.'; return;
    }
    pendant(form, async () => {
      const existant = parCle.get(cle(texte));
      const { error } = existant
        ? await sb.from('valise_objets').update({ perso: true }).eq('id', existant.id)
        : await sb.from('valise_objets').insert({ sejour_id: sejourId, texte });
      if (error) throw error;
      await recharger();
      app.querySelector('#formObjet input')?.focus();
    });
  };

  const liste = app.querySelector('.liste-valise');
  liste.addEventListener('change', async e => {
    const caseCochee = e.target.closest('[data-cocher]');
    if (!caseCochee) return;
    const k = caseCochee.closest('[data-cle]').dataset.cle;
    const existant = parCle.get(k);
    const texte = planning.find(p => p.cle === k)?.texte || existant?.texte;
    const { error } = existant
      ? await sb.from('valise_objets').update({ fait: caseCochee.checked }).eq('id', existant.id)
      : await sb.from('valise_objets').insert({ sejour_id: sejourId, texte, perso: false, fait: caseCochee.checked });
    if (error) { caseCochee.checked = !caseCochee.checked; toast(messageErreur(error)); } else recharger();
  });
  liste.addEventListener('click', async e => {
    const bouton = e.target.closest('[data-supprimer]');
    if (!bouton) return;
    const o = parCle.get(bouton.closest('[data-cle]').dataset.cle);
    const { error } = await sb.from('valise_objets').delete().eq('id', o.id);
    if (error) toast(messageErreur(error)); else recharger();
  });
}

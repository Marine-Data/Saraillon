// Planya — corvées du séjour.
// La liste est propre à chaque groupe ; chaque jour, un tirage au sort équitable répartit les corvées
// entre les personnes présentes, puis chacun peut échanger ou se proposer à la main.
// Règles d'accès : sql/005_corvees.sql (membres du séjour uniquement).
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const LISTE_PROPOSEE = ['Préparer le petit-déjeuner', 'Préparer le déjeuner', 'Préparer le dîner',
  'Vaisselle', 'Sortir les poubelles', 'Ménage des pièces communes'];

const isoJour = d => d.toISOString().slice(0, 10);
function joursEntre(debut, fin) {
  const jours = [];
  const d = new Date(debut + 'T12:00:00'), f = new Date(fin + 'T12:00:00');
  while (d <= f && jours.length < 90) { jours.push(isoJour(d)); d.setDate(d.getDate() + 1); }
  return jours;
}
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
const jourLong = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const melanger = t => { const c = [...t]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

// Tirage équitable : chaque corvée va à la personne présente qui en a le moins ce jour-là,
// puis le moins sur l'ensemble du séjour ; à égalité, au hasard.
export function tirage(corvees, presents, totaux, dejaDuJour = new Map()) {
  const duJour = new Map(presents.map(id => [id, dejaDuJour.get(id) || 0]));
  const total = new Map(presents.map(id => [id, totaux.get(id) || 0]));
  return melanger(corvees).map(c => {
    const choisi = melanger(presents).sort((a, b) => duJour.get(a) - duJour.get(b) || total.get(a) - total.get(b))[0];
    duJour.set(choisi, duJour.get(choisi) + 1);
    total.set(choisi, total.get(choisi) + 1);
    return { corvee_id: c.id, user_id: choisi };
  });
}

async function charger(sejourId) {
  const [s, m, c, a] = await Promise.all([
    sb.from('sejours').select('id, nom, debut, fin').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom').eq('sejour_id', sejourId).order('rejoint_le'),
    sb.from('corvees').select('*').eq('sejour_id', sejourId).order('ordre').order('cree_le'),
    sb.from('corvee_attributions').select('*').eq('sejour_id', sejourId),
  ]);
  const erreur = s.error || m.error || c.error || a.error;
  if (erreur) throw erreur;
  return { sejour: s.data, membres: m.data || [], corvees: c.data || [], attributions: a.data || [] };
}

const jourChoisi = new Map();

export async function ecranCorvees(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement des corvées…</p>';
  let donnees;
  try { donnees = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, corvees, attributions } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const moi = session.user.id;
  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranCorvees(app, sejourId, session, { garderPosition: true });

  const jours = sejour.debut && sejour.fin ? joursEntre(sejour.debut, sejour.fin) : [];
  const aujourdhui = isoJour(new Date());
  let jour = jourChoisi.get(sejourId) || (jours.includes(aujourdhui) ? aujourdhui : jours[0] || aujourdhui);
  if (jours.length && !jours.includes(jour)) jour = jours[0];
  jourChoisi.set(sejourId, jour);

  const duJour = new Map(attributions.filter(a => a.jour === jour).map(a => [a.corvee_id, a]));
  const parPersonne = new Map(membres.map(m => [m.user_id, { total: 0, faites: 0 }]));
  attributions.filter(a => a.user_id && parPersonne.has(a.user_id)).forEach(a => {
    const p = parPersonne.get(a.user_id); p.total++; if (a.fait) p.faites++;
  });

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Corvées</h1>
    ${jours.length ? `<div class="jours-puces" role="tablist">${jours.map(j => `
      <button role="tab" class="puce-jour" data-jour="${j}" aria-selected="${j === jour}">${esc(jourCourt(j))}</button>`).join('')}</div>`
    : `<label for="choixJour">Jour</label><input id="choixJour" type="date" value="${jour}">`}

    <section class="carte">
      <h2>${esc(jourLong(jour).replace(/^./, c => c.toUpperCase()))}</h2>
      ${corvees.length ? `<ul class="liste corvees">${corvees.map(c => {
        const a = duJour.get(c.id);
        return `
        <li class="corvee ${a?.fait ? 'fait' : ''}" data-corvee="${c.id}">
          <label class="corvee-nom"><input type="checkbox" data-fait ${a?.fait ? 'checked' : ''} aria-label="${esc(c.nom)} faite"> <span>${esc(c.nom)}</span></label>
          <select data-personne aria-label="Qui fait : ${esc(c.nom)}">
            <option value="">Personne</option>
            ${membres.map(m => `<option value="${m.user_id}" ${a?.user_id === m.user_id ? 'selected' : ''}>${esc(m.prenom)}${m.user_id === moi ? ' (moi)' : ''}</option>`).join('')}
          </select>
        </li>`;
      }).join('')}</ul>
      <button class="btn" id="tirer">🎲 Tirer au sort les corvées du jour</button>`
      : `<p class="info">Pas encore de corvées pour ce séjour.</p>
      <button class="btn" id="proposee">Utiliser la liste proposée</button>
      <p class="info">${LISTE_PROPOSEE.join(', ')}. Tu pourras la modifier ensuite.</p>`}
    </section>

    ${corvees.length ? `
    <details class="carte depliable">
      <summary>Répartition sur le séjour</summary>
      <ul class="liste">${membres.map(m => {
        const p = parPersonne.get(m.user_id);
        return `<li class="membre"><span>${esc(m.prenom)}</span><span>${p.total} corvée${p.total > 1 ? 's' : ''}${p.total ? ` · ${p.faites} faite${p.faites > 1 ? 's' : ''}` : ''}</span></li>`;
      }).join('')}</ul>
    </details>` : ''}

    <details class="carte depliable" id="gestion">
      <summary>Modifier la liste des corvées</summary>
      <ul class="liste">${corvees.map(c => `
        <li class="membre" data-corvee="${c.id}"><span>${esc(c.nom)}</span>
          <button class="lien petit danger-lien" data-retirer aria-label="Retirer ${esc(c.nom)}">✕</button></li>`).join('')}</ul>
      <form id="formCorvee" class="form-commentaire" novalidate>
        <input name="nom" maxlength="80" placeholder="Nouvelle corvée" aria-label="Nouvelle corvée">
        <button class="btn petit" type="submit">Ajouter</button>
        <p class="erreur" role="alert"></p>
      </form>
    </details>
    <dialog id="dlgTirage"></dialog>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelectorAll('[data-jour]').forEach(b => b.onclick = () => { jourChoisi.set(sejourId, b.dataset.jour); recharger(); });
  const choixJour = app.querySelector('#choixJour');
  if (choixJour) choixJour.onchange = () => { if (choixJour.value) { jourChoisi.set(sejourId, choixJour.value); recharger(); } };
  if (garderPosition) app.querySelector('#gestion').open = gestionOuverte;
  app.querySelector('#gestion').addEventListener('toggle', e => { gestionOuverte = e.target.open; });

  const proposee = app.querySelector('#proposee');
  if (proposee) proposee.onclick = async () => {
    proposee.disabled = true;
    const { error } = await sb.from('corvees').insert(LISTE_PROPOSEE.map((nom, ordre) => ({ sejour_id: sejourId, nom, ordre })));
    if (error) { proposee.disabled = false; toast(messageErreur(error)); } else recharger();
  };

  // Attribution manuelle et case « faite » : une ligne par corvée et par jour (création ou mise à jour).
  const enregistrer = async (corvee_id, champs) => {
    const a = duJour.get(corvee_id);
    const { error } = await sb.from('corvee_attributions').upsert(
      { corvee_id, jour, user_id: a?.user_id ?? null, fait: a?.fait ?? false, ...champs }, { onConflict: 'corvee_id,jour' });
    if (error) toast(messageErreur(error));
    recharger();
  };
  app.querySelectorAll('[data-personne]').forEach(s => s.onchange = () =>
    enregistrer(s.closest('[data-corvee]').dataset.corvee, { user_id: s.value || null }));
  app.querySelectorAll('[data-fait]').forEach(c => c.onchange = () =>
    enregistrer(c.closest('[data-corvee]').dataset.corvee, { fait: c.checked }));

  const tirer = app.querySelector('#tirer');
  if (tirer) tirer.onclick = () => ouvrirTirage(app, { sejourId, jour, membres, corvees, attributions, duJour, prenom, recharger });

  app.querySelectorAll('[data-retirer]').forEach(b => b.onclick = async () => {
    const c = corvees.find(x => x.id === b.closest('[data-corvee]').dataset.corvee);
    if (!confirm(`Retirer « ${c.nom} » de la liste ? Ses attributions seront effacées.`)) return;
    const { error } = await sb.from('corvees').delete().eq('id', c.id);
    if (error) toast(messageErreur(error)); else recharger();
  });
  const form = app.querySelector('#formCorvee');
  form.onsubmit = e => {
    e.preventDefault();
    const nom = form.nom.value.trim();
    if (!nom) { form.querySelector('.erreur').textContent = 'Écris le nom de la corvée.'; return; }
    pendant(form, async () => {
      const ordre = corvees.reduce((m, c) => Math.max(m, c.ordre), -1) + 1;
      const { error } = await sb.from('corvees').insert({ sejour_id: sejourId, nom, ordre });
      if (error) throw error;
      gestionOuverte = true;
      recharger();
    });
  };
}
let gestionOuverte = false;

// ---------- Tirage au sort ----------
function ouvrirTirage(app, { sejourId, jour, membres, corvees, attributions, duJour, prenom, recharger }) {
  const dlg = app.querySelector('#dlgTirage');
  const faites = corvees.filter(c => duJour.get(c.id)?.fait);
  const aTirer = corvees.filter(c => !duJour.get(c.id)?.fait);
  dlg.innerHTML = `
    <form novalidate>
      <h2>Tirage du ${esc(jourLong(jour))}</h2>
      <p class="info">Qui est là ce jour-là ? Les corvées sont réparties équitablement entre les personnes cochées.</p>
      <ul class="liste">${membres.map(m => `
        <li class="membre"><label class="case-part"><input type="checkbox" name="present" value="${m.user_id}" checked> ${esc(m.prenom)}</label></li>`).join('')}</ul>
      ${faites.length ? `<p class="info">Déjà faites, gardées telles quelles : ${esc(faites.map(c => c.nom).join(', '))}.</p>` : ''}
      ${aTirer.some(c => duJour.get(c.id)?.user_id) ? '<p class="info">Le tirage remplace les attributions actuelles de ce jour.</p>' : ''}
      <ul class="liste resultat-tirage" hidden></ul>
      <p class="erreur" role="alert"></p>
      <div class="actions-dialogue">
        <button class="btn secondaire" type="button" id="fermerTirage">Annuler</button>
        <button class="btn" type="submit">🎲 Tirer</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  let fini = false;
  dlg.querySelector('#fermerTirage').onclick = () => dlg.close();
  dlg.onclose = () => { if (fini) recharger(); };
  form.onsubmit = e => {
    e.preventDefault();
    const presents = [...form.querySelectorAll('[name=present]:checked')].map(i => i.value);
    if (!presents.length) { form.querySelector('.erreur').textContent = 'Coche au moins une personne.'; return; }
    if (!aTirer.length) { form.querySelector('.erreur').textContent = 'Toutes les corvées du jour sont déjà faites.'; return; }
    // Totaux du séjour, sans compter les attributions de ce jour qui vont être remplacées.
    const totaux = new Map();
    attributions.filter(a => a.user_id && !(a.jour === jour && !a.fait))
      .forEach(a => totaux.set(a.user_id, (totaux.get(a.user_id) || 0) + 1));
    const dejaDuJour = new Map();
    faites.forEach(c => { const u = duJour.get(c.id).user_id; if (u) dejaDuJour.set(u, (dejaDuJour.get(u) || 0) + 1); });
    const resultat = tirage(aTirer, presents, totaux, dejaDuJour);

    pendant(form, async () => {
      // Petite animation : les prénoms défilent avant d'afficher le résultat.
      const liste = form.querySelector('.resultat-tirage');
      liste.hidden = false;
      liste.innerHTML = resultat.map(r => `<li class="membre"><span>${esc(corvees.find(c => c.id === r.corvee_id).nom)}</span><strong data-r="${r.corvee_id}"></strong></li>`).join('');
      const cases = [...liste.querySelectorAll('[data-r]')];
      const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (let t = 0; t < (reduit ? 0 : 12); t++) {
        cases.forEach(c => { c.textContent = prenom(presents[Math.floor(Math.random() * presents.length)]); });
        await new Promise(r => setTimeout(r, 90));
      }
      resultat.forEach((r, i) => { cases[i].textContent = prenom(r.user_id); });
      const { error } = await sb.rpc('enregistrer_tirage', { p_sejour: sejourId, p_jour: jour, p_attributions: resultat });
      if (error) throw error;
      fini = true;
      form.querySelector('button[type=submit]').hidden = true;
      dlg.querySelector('#fermerTirage').textContent = 'Fermer';
    });
  };
  dlg.showModal();
}

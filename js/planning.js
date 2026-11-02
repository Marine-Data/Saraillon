// Planya — planning du séjour.
// Jours du séjour en accordéon ; pour chaque activité : moment ou heure, lieu, repas, notes,
// choses à apporter (cases à cocher), inscriptions et commentaires.
// Règles d'accès : sql/002_planning.sql (membres du séjour uniquement).
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const MOMENTS = [
  ['journee', 'Toute la journée'], ['matin', 'Matin'], ['midi', 'Midi'],
  ['apres-midi', 'Après-midi'], ['soir', 'Soir'],
];
const REPAS = [['petit-dejeuner', 'Petit-déjeuner'], ['dejeuner', 'Déjeuner'], ['diner', 'Dîner'], ['apero', 'Apéro']];
const EMOJIS = ['🏖️', '🌊', '⛵', '🥾', '🏊', '🚴', '🍽️', '🍹', '🛒', '🎉', '🏛️', '🚗', '✈️', '🚉', '🏠', '🌙'];
const libelle = (liste, cle) => (liste.find(([k]) => k === cle) || [, ''])[1];
const RANG_MOMENT = { journee: 0, matin: 1, midi: 2, 'apres-midi': 3, soir: 4 };

// ---------- Dates ----------
const isoJour = d => d.toISOString().slice(0, 10);
function joursEntre(debut, fin) {
  const jours = [];
  const d = new Date(debut + 'T12:00:00'), f = new Date(fin + 'T12:00:00');
  while (d <= f && jours.length < 90) { jours.push(isoJour(d)); d.setDate(d.getDate() + 1); }
  return jours;
}
function titreJour(iso) {
  const t = new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/ 1 /, ' 1er ');
}
const heureCourte = h => (h ? h.slice(0, 5).replace(':', 'h') : '');
function ordreActivite(a, b) {
  const cle = x => (x.heure ? '1' + x.heure : '0' + (RANG_MOMENT[x.moment] ?? 5));
  return cle(a).localeCompare(cle(b)) || a.cree_le.localeCompare(b.cree_le);
}

// ---------- Données ----------
async function charger(sejourId) {
  const [s, m, a] = await Promise.all([
    sb.from('sejours').select('id, nom, debut, fin').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom, role').eq('sejour_id', sejourId),
    sb.from('activites')
      .select('*, activite_apporter(*), activite_inscriptions(user_id), activite_commentaires(id, user_id, texte, cree_le)')
      .eq('sejour_id', sejourId),
  ]);
  const erreur = s.error || m.error || a.error;
  if (erreur) throw erreur;
  return { sejour: s.data, membres: m.data || [], activites: a.data || [] };
}

// ---------- Écran ----------
// Jours dépliés et position de lecture gardés entre deux rechargements (inscription, commentaire…).
const joursDeplies = new Map();

export async function ecranPlanning(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement du planning…</p>';
  let donnees;
  try { donnees = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, activites } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const moi = session.user.id;
  const orga = membres.some(m => m.user_id === moi && m.role === 'organisateur');
  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranPlanning(app, sejourId, session, { garderPosition: true });

  // Jours : ceux du séjour, plus ceux où une activité a été placée hors des dates.
  const jours = new Set(sejour.debut && sejour.fin ? joursEntre(sejour.debut, sejour.fin) : []);
  activites.forEach(a => jours.add(a.jour));
  const listeJours = [...jours].sort();
  const aujourdhui = isoJour(new Date());
  const jourOuvert = listeJours.includes(aujourdhui) ? aujourdhui : listeJours[0];
  if (!joursDeplies.has(sejourId)) joursDeplies.set(sejourId, new Set(jourOuvert ? [jourOuvert] : []));
  const deplies = joursDeplies.get(sejourId);

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Planning</h1>
    ${listeJours.length ? '' : '<p class="vide">Le séjour n’a pas encore de dates. Ajoute une première activité en choisissant son jour.</p>'}
    <div class="jours">${listeJours.map(j => {
      const duJour = activites.filter(a => a.jour === j).sort(ordreActivite);
      return `
      <details class="jour" data-jour="${j}" ${deplies.has(j) ? 'open' : ''}>
        <summary><span>${esc(titreJour(j))}</span><span class="badge">${duJour.length || '—'}</span></summary>
        <div class="jour-contenu">
          ${duJour.map(a => carteActivite(a, { moi, orga, prenom })).join('') || '<p class="info">Rien de prévu pour l’instant.</p>'}
          <button class="btn secondaire" data-ajouter="${j}">+ Ajouter une activité</button>
        </div>
      </details>`;
    }).join('')}</div>
    <button class="btn" id="ajouterLibre">+ Ajouter une activité</button>
    <dialog id="dlgActivite"></dialog>`;

  window.scrollTo(0, position);
  app.querySelectorAll('details.jour').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) deplies.add(d.dataset.jour); else deplies.delete(d.dataset.jour);
  }));
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelector('#ajouterLibre').onclick = () => ouvrirFormulaire(app, { sejourId, jour: jourOuvert || aujourdhui, listeJours, recharger });
  app.querySelectorAll('[data-ajouter]').forEach(b => b.onclick = () =>
    ouvrirFormulaire(app, { sejourId, jour: b.dataset.ajouter, listeJours, recharger }));

  // Actions sur les activités (délégation : un seul écouteur pour tout l'écran).
  app.querySelector('.jours').addEventListener('click', async e => {
    const cible = e.target.closest('[data-action]');
    if (!cible) return;
    const id = cible.closest('[data-activite]').dataset.activite;
    const act = activites.find(a => a.id === id);
    const action = cible.dataset.action;
    let erreur = null;
    if (action === 'modifier') return ouvrirFormulaire(app, { sejourId, activite: act, listeJours, recharger });
    if (action === 'supprimer') {
      if (!confirm(`Supprimer « ${act.nom} » ?`)) return;
      ({ error: erreur } = await sb.from('activites').delete().eq('id', id));
    } else if (action === 'inscrire') {
      ({ error: erreur } = await sb.from('activite_inscriptions').insert({ activite_id: id, sejour_id: sejourId }));
    } else if (action === 'desinscrire') {
      ({ error: erreur } = await sb.from('activite_inscriptions').delete().eq('activite_id', id).eq('user_id', moi));
    } else if (action === 'effacer-commentaire') {
      if (!confirm('Effacer ce commentaire ?')) return;
      ({ error: erreur } = await sb.from('activite_commentaires').delete().eq('id', cible.dataset.id));
    } else return;
    if (erreur) toast(messageErreur(erreur)); else recharger();
  });
  app.querySelector('.jours').addEventListener('change', async e => {
    const caseApporter = e.target.closest('[data-apporter]');
    if (!caseApporter) return;
    const { error } = await sb.from('activite_apporter').update({ fait: caseApporter.checked }).eq('id', caseApporter.dataset.apporter);
    if (error) { caseApporter.checked = !caseApporter.checked; toast(messageErreur(error)); }
  });
  app.querySelector('.jours').addEventListener('submit', async e => {
    const form = e.target.closest('.form-commentaire');
    if (!form) return;
    e.preventDefault();
    const texte = form.texte.value.trim();
    if (!texte) return;
    const activite_id = form.closest('[data-activite]').dataset.activite;
    await pendant(form, async () => {
      const { error } = await sb.from('activite_commentaires').insert({ activite_id, sejour_id: sejourId, texte });
      if (error) throw error;
      recharger();
    });
  });
}

function carteActivite(a, { moi, orga, prenom }) {
  const inscrits = a.activite_inscriptions.map(i => i.user_id);
  const suisInscrit = inscrits.includes(moi);
  const quand = a.heure ? heureCourte(a.heure) : libelle(MOMENTS, a.moment);
  const apporter = [...a.activite_apporter].sort((x, y) => x.ordre - y.ordre);
  const commentaires = [...a.activite_commentaires].sort((x, y) => x.cree_le.localeCompare(y.cree_le));
  return `
  <article class="activite" data-activite="${a.id}">
    <header>
      <span class="emoji" aria-hidden="true">${esc(a.emoji || '📌')}</span>
      <div>
        <h3>${esc(a.nom)}</h3>
        <p class="meta">${esc([quand, a.lieu].filter(Boolean).join(' · '))}</p>
      </div>
      ${a.repas ? `<span class="badge">${esc(libelle(REPAS, a.repas))}</span>` : ''}
    </header>
    ${a.notes ? `<p class="notes">${esc(a.notes)}</p>` : ''}
    ${apporter.length ? `<div class="bloc"><h4>À apporter</h4><ul class="apporter">${apporter.map(x => `
      <li><label><input type="checkbox" data-apporter="${x.id}" ${x.fait ? 'checked' : ''}> <span>${esc(x.texte)}</span></label></li>`).join('')}</ul></div>` : ''}
    ${a.inscription_ouverte ? `<div class="bloc"><h4>Participants (${inscrits.length})</h4>
      <p class="participants">${inscrits.map(id => `<span class="puce">${esc(prenom(id))}</span>`).join('') || '<span class="info">Personne pour l’instant.</span>'}</p>
      <button class="btn ${suisInscrit ? 'secondaire' : ''} petit" data-action="${suisInscrit ? 'desinscrire' : 'inscrire'}">
        ${suisInscrit ? 'Je ne participe plus' : 'Je participe'}</button></div>` : ''}
    <div class="bloc"><h4>Commentaires${commentaires.length ? ` (${commentaires.length})` : ''}</h4>
      ${commentaires.map(c => `<p class="commentaire"><strong>${esc(prenom(c.user_id))}</strong> ${esc(c.texte)}
        ${c.user_id === moi || orga ? `<button class="lien petit" data-action="effacer-commentaire" data-id="${c.id}" aria-label="Effacer le commentaire">✕</button>` : ''}</p>`).join('')}
      <form class="form-commentaire" novalidate>
        <input name="texte" maxlength="1000" placeholder="Ajouter un commentaire" aria-label="Ajouter un commentaire">
        <button class="btn petit" type="submit">Envoyer</button>
        <p class="erreur" role="alert"></p>
      </form>
    </div>
    <footer class="actions-activite">
      <button class="lien" data-action="modifier">Modifier</button>
      ${a.cree_par === moi || orga ? '<button class="lien danger-lien" data-action="supprimer">Supprimer</button>' : ''}
    </footer>
  </article>`;
}

// ---------- Formulaire d'ajout / modification ----------
function ouvrirFormulaire(app, { sejourId, activite = null, jour, listeJours, recharger }) {
  const a = activite || { jour, moment: '', heure: '', nom: '', emoji: '', lieu: '', repas: '', notes: '', inscription_ouverte: false, activite_apporter: [] };
  const dlg = app.querySelector('#dlgActivite');
  const apporterTexte = [...a.activite_apporter].sort((x, y) => x.ordre - y.ordre).map(x => x.texte).join('\n');
  dlg.innerHTML = `
    <form id="formActivite" novalidate>
      <h2>${activite ? 'Modifier l’activité' : 'Nouvelle activité'}</h2>
      <label for="fNom">Nom</label>
      <input id="fNom" name="nom" maxlength="120" required value="${esc(a.nom)}" placeholder="Ex. : Plage de l’Almanarre">
      <label>Emoji</label>
      <div class="emojis" role="radiogroup">${EMOJIS.map(e => `
        <button type="button" class="emoji-choix" aria-pressed="${a.emoji === e}" data-emoji="${e}">${e}</button>`).join('')}</div>
      <input type="hidden" name="emoji" value="${esc(a.emoji || '')}">
      <div class="deux">
        <div><label for="fJour">Jour</label>
          <input id="fJour" name="jour" type="date" required value="${esc(a.jour)}" list="joursSejour"></div>
        <div><label for="fHeure">Heure (facultatif)</label>
          <input id="fHeure" name="heure" type="time" value="${esc(a.heure ? a.heure.slice(0, 5) : '')}"></div>
      </div>
      <datalist id="joursSejour">${listeJours.map(j => `<option value="${j}">`).join('')}</datalist>
      <label for="fMoment">Moment</label>
      <select id="fMoment" name="moment"><option value="">—</option>${MOMENTS.map(([k, v]) => `<option value="${k}" ${a.moment === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label for="fLieu">Lieu</label>
      <input id="fLieu" name="lieu" maxlength="160" value="${esc(a.lieu || '')}">
      <label for="fRepas">Repas</label>
      <select id="fRepas" name="repas"><option value="">Aucun</option>${REPAS.map(([k, v]) => `<option value="${k}" ${a.repas === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label for="fNotes">Notes</label>
      <textarea id="fNotes" name="notes" maxlength="2000" rows="3">${esc(a.notes || '')}</textarea>
      <label for="fApporter">À apporter (une chose par ligne)</label>
      <textarea id="fApporter" name="apporter" rows="3" placeholder="Crème solaire&#10;Parasol">${esc(apporterTexte)}</textarea>
      <label class="case"><input type="checkbox" name="inscription" ${a.inscription_ouverte ? 'checked' : ''}> Chacun s’inscrit à cette activité</label>
      <p class="erreur" role="alert"></p>
      <div class="actions-dialogue">
        <button class="btn secondaire" type="button" id="annulerActivite">Annuler</button>
        <button class="btn" type="submit">${activite ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelectorAll('[data-emoji]').forEach(b => b.onclick = () => {
    const actif = b.getAttribute('aria-pressed') === 'true';
    dlg.querySelectorAll('[data-emoji]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', String(!actif));
    form.emoji.value = actif ? '' : b.dataset.emoji;
  });
  dlg.querySelector('#annulerActivite').onclick = () => dlg.close();
  form.onsubmit = e => {
    e.preventDefault();
    const v = k => form[k].value.trim();
    if (!v('nom') || !v('jour')) { form.querySelector('.erreur').textContent = 'Le nom et le jour sont obligatoires.'; return; }
    const champs = {
      nom: v('nom'), emoji: v('emoji') || null, jour: v('jour'), heure: v('heure') || null,
      moment: v('moment') || null, lieu: v('lieu') || null, repas: v('repas') || null,
      notes: v('notes') || null, inscription_ouverte: form.inscription.checked,
    };
    const lignes = form.apporter.value.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 50);
    pendant(form, async () => {
      let id = activite?.id;
      if (activite) {
        const { error } = await sb.from('activites').update(champs).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('activites').insert({ ...champs, sejour_id: sejourId }).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      await synchroniserApporter(id, sejourId, a.activite_apporter, lignes);
      joursDeplies.get(sejourId)?.add(champs.jour);
      dlg.close();
      toast(activite ? 'Activité modifiée.' : 'Activité ajoutée.');
      recharger();
    });
  };
  dlg.showModal();
  form.nom.focus();
}

// Garde les éléments inchangés (et leur case cochée), retire les lignes effacées, ajoute les nouvelles.
async function synchroniserApporter(activiteId, sejourId, existants, lignes) {
  const aRetirer = existants.filter(x => !lignes.includes(x.texte)).map(x => x.id);
  if (aRetirer.length) {
    const { error } = await sb.from('activite_apporter').delete().in('id', aRetirer);
    if (error) throw error;
  }
  const textesExistants = existants.map(x => x.texte);
  const nouveaux = lignes
    .map((texte, ordre) => ({ texte, ordre }))
    .filter(x => !textesExistants.includes(x.texte))
    .map(x => ({ ...x, activite_id: activiteId, sejour_id: sejourId }));
  if (nouveaux.length) {
    const { error } = await sb.from('activite_apporter').insert(nouveaux);
    if (error) throw error;
  }
}

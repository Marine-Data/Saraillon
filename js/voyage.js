// Planya — voyage : fiche d'infos du séjour, « qui arrive quand », mon voyage et mes billets.
// Les billets sont dans un espace de stockage privé : seule la personne qui les dépose peut les ouvrir.
// Règles d'accès : sql/006_voyage.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const BUCKET = 'planya-billets';
const TAILLE_MAX = 10 * 1024 * 1024;
const CHAMPS_FICHE = [
  ['adresse', 'Adresse du logement', 'Ex. : 12 chemin des Pins, 83000 Toulon', 2],
  ['acces', 'Accès et codes', 'Ex. : code du portail 1234, clés dans la boîte aux lettres', 2],
  ['wifi', 'Wifi', 'Ex. : réseau MaisonMer, mot de passe soleil83', 1],
  ['contacts', 'Contacts utiles', 'Ex. : propriétaire, taxi, médecin', 3],
  ['notes', 'À savoir', 'Ex. : arrivée possible à partir de 16 h', 3],
];
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const heureCourte = h => (h ? h.slice(0, 5).replace(':', 'h') : '');

async function charger(sejourId, moi) {
  const [s, m, f, t, b] = await Promise.all([
    sb.from('sejours').select('id, nom, debut, fin').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom').eq('sejour_id', sejourId).order('rejoint_le'),
    sb.from('fiche_sejour').select('*').eq('sejour_id', sejourId).maybeSingle(),
    sb.from('trajets').select('*').eq('sejour_id', sejourId),
    sb.from('billets').select('*').eq('sejour_id', sejourId).eq('user_id', moi).order('cree_le'),
  ]);
  const erreur = s.error || m.error || f.error || t.error || b.error;
  if (erreur) throw erreur;
  // Liens d'ouverture temporaires (1 heure) pour mes billets.
  let liens = new Map();
  if (b.data?.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(b.data.map(x => x.chemin), 3600);
    liens = new Map((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
  return { sejour: s.data, membres: m.data || [], fiche: f.data, trajets: t.data || [], billets: b.data || [], liens };
}

// Regroupe les personnes qui voyagent ensemble (même jour, heure, lieu et note).
function regrouper(trajets, sens, prenom) {
  const groupes = new Map();
  trajets.filter(t => t.sens === sens && (t.jour || t.lieu || t.heure)).forEach(t => {
    const cle = [t.jour, t.heure?.slice(0, 5), t.lieu?.trim().toLowerCase(), t.note?.trim()].join('|');
    if (!groupes.has(cle)) groupes.set(cle, { ...t, noms: [] });
    groupes.get(cle).noms.push(prenom(t.user_id));
  });
  return [...groupes.values()].sort((a, b) => ((a.jour || '9') + (a.heure || '9')).localeCompare((b.jour || '9') + (b.heure || '9')));
}

const lienCarte = adresse => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adresse);

export async function ecranVoyage(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement…</p>';
  const moi = session.user.id;
  let donnees;
  try { donnees = await charger(sejourId, moi); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, fiche, trajets, billets, liens } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranVoyage(app, sejourId, session, { garderPosition: true });
  const remplie = fiche && CHAMPS_FICHE.some(([k]) => fiche[k]);
  const mien = sens => trajets.find(t => t.user_id === moi && t.sens === sens) || {};
  const renseignes = new Set(trajets.filter(t => t.jour || t.lieu || t.heure || t.note).map(t => t.user_id));
  const manquants = membres.filter(m => !renseignes.has(m.user_id));
  const lieux = [...new Set(trajets.map(t => t.lieu).filter(Boolean))];

  const listeTrajets = (sens) => {
    const g = regrouper(trajets, sens, prenom);
    return g.length ? g.map(e => `
      <li class="trajet">
        <div class="quand"><strong>${e.jour ? esc(jourCourt(e.jour)) : 'Jour ?'}</strong><span>${esc(heureCourte(e.heure)) || '—'}</span></div>
        <div><strong>${esc(e.noms.join(', '))}</strong>${e.lieu ? ` · ${esc(e.lieu)}` : ''}
          ${e.note ? `<p class="meta">${esc(e.note)}</p>` : ''}</div>
      </li>`).join('') : '<li class="info">Rien de renseigné pour l’instant.</li>';
  };

  const blocMonTrajet = (sens, titre, aide) => {
    const t = mien(sens);
    return `
      <fieldset class="mon-trajet">
        <legend>${titre}</legend>
        <p class="info">${aide}</p>
        <div class="deux">
          <div><label for="${sens}Jour">Jour</label><input id="${sens}Jour" name="${sens}_jour" type="date" value="${esc(t.jour || '')}"></div>
          <div><label for="${sens}Heure">Heure</label><input id="${sens}Heure" name="${sens}_heure" type="time" value="${esc(t.heure ? t.heure.slice(0, 5) : '')}"></div>
        </div>
        <label for="${sens}Lieu">Lieu</label>
        <input id="${sens}Lieu" name="${sens}_lieu" maxlength="120" list="lieuxConnus" value="${esc(t.lieu || '')}" placeholder="Ex. : Gare de Toulon">
        <label for="${sens}Note">Un détail ?</label>
        <input id="${sens}Note" name="${sens}_note" maxlength="300" value="${esc(t.note || '')}" placeholder="Ex. : train de 18h40 depuis Paris, en voiture…">
      </fieldset>`;
  };

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Voyage</h1>

    <section class="carte">
      <div class="entete-section"><h2>Infos du séjour</h2>${remplie ? '<button class="lien" id="modifierFiche">Modifier</button>' : ''}</div>
      ${remplie ? `<dl class="fiche">${CHAMPS_FICHE.filter(([k]) => fiche[k]).map(([k, libelle]) => `
        <dt>${libelle}</dt>
        <dd>${esc(fiche[k])}${k === 'adresse' ? `<br><a href="${lienCarte(fiche[k])}" target="_blank" rel="noopener">Ouvrir dans un plan</a>` : ''}</dd>`).join('')}</dl>
        <p class="meta">Mis à jour par ${esc(prenom(fiche.maj_par))}.</p>`
      : `<p class="info">Adresse, codes, wifi, contacts : tout ce que le groupe doit savoir, au même endroit.</p>
        <button class="btn secondaire" id="modifierFiche">Remplir la fiche</button>`}
    </section>

    <section class="carte">
      <h2>Qui arrive quand</h2>
      <h3 class="groupe">🛬 Arrivées</h3><ul class="liste">${listeTrajets('arrivee')}</ul>
      <h3 class="groupe">🛫 Départs</h3><ul class="liste">${listeTrajets('depart')}</ul>
      ${manquants.length ? `<p class="info">Pas encore renseigné : ${esc(manquants.map(m => m.prenom).join(', '))}.</p>` : ''}
    </section>

    <form class="carte" id="formTrajets" novalidate>
      <h2>Mon voyage</h2>
      ${blocMonTrajet('arrivee', '🛬 Mon arrivée', 'Là où le groupe peut venir te chercher.')}
      ${blocMonTrajet('depart', '🛫 Mon départ', 'Là où le groupe doit te déposer.')}
      <datalist id="lieuxConnus">${lieux.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Enregistrer mon voyage</button>
    </form>

    <section class="carte">
      <h2>Mes billets</h2>
      <p class="info">🔒 Personne d’autre ne peut les ouvrir : le groupe ne voit que tes horaires.</p>
      <ul class="liste">${billets.map(b => `
        <li class="membre" data-billet="${b.id}">
          ${liens.has(b.chemin) ? `<a href="${esc(liens.get(b.chemin))}" target="_blank" rel="noopener">📄 ${esc(b.nom_fichier)}</a>` : `<span>📄 ${esc(b.nom_fichier)}</span>`}
          <button class="lien petit danger-lien" data-supprimer aria-label="Supprimer ${esc(b.nom_fichier)}">✕</button>
        </li>`).join('') || '<li class="info">Aucun billet pour l’instant.</li>'}</ul>
      <label class="btn secondaire depot">📎 Ajouter un billet (PDF ou photo, 10 Mo max)
        <input type="file" id="fichierBillet" accept="application/pdf,image/*" hidden></label>
    </section>
    <dialog id="dlgFiche"></dialog>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelector('#modifierFiche').onclick = () => ouvrirFiche(app, { sejourId, fiche, recharger });

  const form = app.querySelector('#formTrajets');
  form.onsubmit = e => {
    e.preventDefault();
    pendant(form, async () => {
      for (const sens of ['arrivee', 'depart']) {
        const v = k => form[`${sens}_${k}`].value.trim() || null;
        const champs = { jour: v('jour'), heure: v('heure'), lieu: v('lieu'), note: v('note') };
        const vide = Object.values(champs).every(x => !x);
        const existe = trajets.some(t => t.user_id === moi && t.sens === sens);
        let error = null;
        if (vide && existe) ({ error } = await sb.from('trajets').delete().eq('sejour_id', sejourId).eq('user_id', moi).eq('sens', sens));
        else if (!vide && existe) ({ error } = await sb.from('trajets').update(champs).eq('sejour_id', sejourId).eq('user_id', moi).eq('sens', sens));
        else if (!vide) ({ error } = await sb.from('trajets').insert({ sejour_id: sejourId, sens, ...champs }));
        if (error) throw error;
      }
      toast('Ton voyage est enregistré.');
      recharger();
    });
  };

  app.querySelector('#fichierBillet').onchange = async e => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX) { toast('Fichier trop lourd : 10 Mo maximum.'); return; }
    const nomPropre = fichier.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
    const chemin = `${sejourId}/${moi}/${crypto.randomUUID()}-${nomPropre}`;
    toast('Envoi du billet…');
    const { error: e1 } = await sb.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type || undefined });
    if (e1) { toast(messageErreur(e1)); return; }
    const { error: e2 } = await sb.from('billets').insert({ sejour_id: sejourId, nom_fichier: fichier.name.slice(0, 200), chemin });
    if (e2) { await sb.storage.from(BUCKET).remove([chemin]); toast(messageErreur(e2)); return; }
    toast('Billet ajouté.');
    recharger();
  };

  app.querySelectorAll('[data-supprimer]').forEach(bouton => bouton.onclick = async () => {
    const b = billets.find(x => x.id === bouton.closest('[data-billet]').dataset.billet);
    if (!confirm(`Supprimer « ${b.nom_fichier} » ?`)) return;
    const { error: e1 } = await sb.storage.from(BUCKET).remove([b.chemin]);
    if (e1) { toast(messageErreur(e1)); return; }
    const { error: e2 } = await sb.from('billets').delete().eq('id', b.id);
    if (e2) toast(messageErreur(e2)); else recharger();
  });
}

function ouvrirFiche(app, { sejourId, fiche, recharger }) {
  const dlg = app.querySelector('#dlgFiche');
  dlg.innerHTML = `
    <form novalidate>
      <h2>Infos du séjour</h2>
      <p class="info">Visibles et modifiables par tous les membres du séjour.</p>
      ${CHAMPS_FICHE.map(([k, libelle, exemple, lignes]) => `
        <label for="fiche-${k}">${libelle}</label>
        <textarea id="fiche-${k}" name="${k}" rows="${lignes}" placeholder="${esc(exemple)}">${esc(fiche?.[k] || '')}</textarea>`).join('')}
      <p class="erreur" role="alert"></p>
      <div class="actions-dialogue">
        <button class="btn secondaire" type="button" id="annulerFiche">Annuler</button>
        <button class="btn" type="submit">Enregistrer</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelector('#annulerFiche').onclick = () => dlg.close();
  form.onsubmit = e => {
    e.preventDefault();
    const champs = Object.fromEntries(CHAMPS_FICHE.map(([k]) => [k, form[k].value.trim() || null]));
    pendant(form, async () => {
      const { error } = fiche
        ? await sb.from('fiche_sejour').update(champs).eq('sejour_id', sejourId)
        : await sb.from('fiche_sejour').insert({ sejour_id: sejourId, ...champs });
      if (error) throw error;
      dlg.close();
      recharger();
    });
  };
  dlg.showModal();
}

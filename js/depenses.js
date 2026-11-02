// Planya — dépenses partagées du séjour.
// Qui a payé quoi, partage à parts égales ou en montants libres, soldes,
// « qui doit combien à qui » et remboursements.
// Règles d'accès et vérifications : sql/003_depenses.sql. Montants en centimes.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';

const euros = c => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const versCentimes = texte => {
  const n = parseFloat(String(texte).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const versSaisie = c => (c / 100).toFixed(2).replace('.', ',');
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Répartit un montant à parts égales, au centime près : les centimes restants vont aux premières personnes.
export function partsEgales(montant, ids) {
  const base = Math.floor(montant / ids.length);
  const reste = montant - base * ids.length;
  return ids.map((user_id, i) => ({ user_id, part: base + (i < reste ? 1 : 0) }));
}

// Solde de chacun : ce qu'il a payé moins ce qu'il doit (positif = on lui doit de l'argent).
export function soldes(depenses) {
  const s = new Map();
  const ajoute = (id, v) => s.set(id, (s.get(id) || 0) + v);
  for (const d of depenses) {
    ajoute(d.paye_par, d.montant_centimes);
    for (const p of d.depense_parts) ajoute(p.user_id, -p.part_centimes);
  }
  return s;
}

// Remboursements suggérés : le plus petit nombre de virements, en associant les plus grosses dettes
// aux plus grosses créances.
export function remboursements(s) {
  const dus = [...s].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const recus = [...s].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const liste = [];
  let i = 0, j = 0;
  while (i < dus.length && j < recus.length) {
    const m = Math.min(dus[i].v, recus[j].v);
    if (m > 0) liste.push({ de: dus[i].id, a: recus[j].id, montant: m });
    dus[i].v -= m; recus[j].v -= m;
    if (!dus[i].v) i++;
    if (!recus[j].v) j++;
  }
  return liste;
}

async function charger(sejourId) {
  const [s, m, d] = await Promise.all([
    sb.from('sejours').select('id, nom').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom, role').eq('sejour_id', sejourId).order('rejoint_le'),
    sb.from('depenses').select('*, depense_parts(user_id, part_centimes)').eq('sejour_id', sejourId)
      .order('jour', { ascending: false }).order('cree_le', { ascending: false }),
  ]);
  const erreur = s.error || m.error || d.error;
  if (erreur) throw erreur;
  return { sejour: s.data, membres: m.data || [], depenses: d.data || [] };
}

export async function ecranDepenses(app, sejourId, session, { garderPosition = false } = {}) {
  const position = garderPosition ? window.scrollY : 0;
  if (!garderPosition) app.innerHTML = '<p class="chargement">Chargement des dépenses…</p>';
  let donnees;
  try { donnees = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, depenses } = donnees;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const moi = session.user.id;
  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranDepenses(app, sejourId, session, { garderPosition: true });
  const s = soldes(depenses);
  const aRembourser = remboursements(s);
  const total = depenses.filter(d => d.type === 'depense').reduce((t, d) => t + d.montant_centimes, 0);
  // Membres actuels, plus les anciens membres qui ont encore un solde.
  const personnes = [...membres.map(m => m.user_id), ...[...s.keys()].filter(id => s.get(id) && !membres.some(m => m.user_id === id))];

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Dépenses</h1>
    <p class="intro">Total du séjour : <strong>${euros(total)}</strong></p>

    <section class="carte">
      <h2>Soldes</h2>
      <ul class="liste soldes">${personnes.map(id => {
        const v = s.get(id) || 0;
        return `<li class="membre"><span>${esc(prenom(id))}${id === moi ? ' <em>(toi)</em>' : ''}</span>
          <span class="${v > 0 ? 'positif' : v < 0 ? 'negatif' : ''}">${v > 0 ? '+' : ''}${euros(v)}</span></li>`;
      }).join('')}</ul>
      <h2 class="sous-titre">Qui doit combien à qui</h2>
      ${aRembourser.length ? `<ul class="liste">${aRembourser.map((r, i) => `
        <li class="dette">
          <span><strong>${esc(prenom(r.de))}</strong> doit <strong>${euros(r.montant)}</strong> à <strong>${esc(prenom(r.a))}</strong></span>
          <button class="btn secondaire petit" data-rembourser="${i}">Marquer remboursé</button>
        </li>`).join('')}</ul>
        <button class="lien" id="partager">Partager les comptes</button>`
      : '<p class="info">Les comptes sont équilibrés : personne ne doit rien.</p>'}
    </section>

    <button class="btn" id="ajouter">+ Ajouter une dépense</button>

    <section class="historique">
      <h2>Historique</h2>
      ${depenses.length ? depenses.map(d => ligneDepense(d, prenom)).join('') : '<p class="vide">Aucune dépense pour l’instant.</p>'}
    </section>
    <dialog id="dlgDepense"></dialog>`;

  window.scrollTo(0, position);
  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  app.querySelector('#ajouter').onclick = () => ouvrirFormulaire(app, { sejourId, membres, moi, recharger });

  app.querySelectorAll('[data-rembourser]').forEach(b => b.onclick = async () => {
    const r = aRembourser[Number(b.dataset.rembourser)];
    if (!confirm(`${prenom(r.de)} a bien remboursé ${euros(r.montant)} à ${prenom(r.a)} ?`)) return;
    b.disabled = true;
    const { error } = await sb.rpc('enregistrer_depense', {
      p_sejour: sejourId, p_id: null, p_type: 'remboursement', p_description: null,
      p_montant: r.montant, p_paye_par: r.de, p_jour: aujourdhui(), p_parts: [{ user_id: r.a, part: r.montant }],
    });
    if (error) { b.disabled = false; toast(messageErreur(error)); } else { toast('Remboursement enregistré.'); recharger(); }
  });

  const partager = app.querySelector('#partager');
  if (partager) partager.onclick = async () => {
    const texte = `💰 Comptes du séjour « ${sejour.nom} »\n\n`
      + aRembourser.map(r => `• ${prenom(r.de)} doit ${euros(r.montant)} à ${prenom(r.a)}`).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Planya', text: texte });
      else { await navigator.clipboard.writeText(texte); toast('Comptes copiés.'); }
    } catch (e) { /* partage annulé */ }
  };

  app.querySelector('.historique').addEventListener('click', async e => {
    const cible = e.target.closest('[data-action]');
    if (!cible) return;
    const d = depenses.find(x => x.id === cible.closest('[data-depense]').dataset.depense);
    if (cible.dataset.action === 'modifier') return ouvrirFormulaire(app, { sejourId, membres, moi, recharger, depense: d });
    if (cible.dataset.action === 'supprimer') {
      const quoi = d.type === 'remboursement' ? 'ce remboursement' : `« ${d.description || 'cette dépense'} »`;
      if (!confirm(`Supprimer ${quoi} ?`)) return;
      const { error } = await sb.from('depenses').delete().eq('id', d.id);
      if (error) toast(messageErreur(error)); else recharger();
    }
  });
}

function ligneDepense(d, prenom) {
  if (d.type === 'remboursement') {
    const a = d.depense_parts[0]?.user_id;
    return `
    <article class="depense remboursement" data-depense="${d.id}">
      <div><strong>${esc(prenom(d.paye_par))}</strong> a remboursé <strong>${esc(prenom(a))}</strong>
        <p class="meta">${jourCourt(d.jour)}</p></div>
      <div class="droite"><span class="montant">${euros(d.montant_centimes)}</span>
        <button class="lien danger-lien" data-action="supprimer">Supprimer</button></div>
    </article>`;
  }
  const pour = d.depense_parts.filter(p => p.part_centimes > 0);
  const egales = new Set(pour.map(p => p.part_centimes)).size <= 1
    || Math.max(...pour.map(p => p.part_centimes)) - Math.min(...pour.map(p => p.part_centimes)) <= 1;
  const detail = egales
    ? 'pour ' + pour.map(p => prenom(p.user_id)).join(', ')
    : pour.map(p => `${prenom(p.user_id)} ${euros(p.part_centimes)}`).join(' · ');
  return `
    <article class="depense" data-depense="${d.id}">
      <div><strong>${esc(d.description || 'Dépense')}</strong>
        <p class="meta">Payé par ${esc(prenom(d.paye_par))} · ${jourCourt(d.jour)}</p>
        <p class="meta">${esc(detail)}</p></div>
      <div class="droite"><span class="montant">${euros(d.montant_centimes)}</span>
        <span><button class="lien" data-action="modifier">Modifier</button>
        <button class="lien danger-lien" data-action="supprimer">Supprimer</button></span></div>
    </article>`;
}

// ---------- Formulaire d'ajout / modification ----------
function ouvrirFormulaire(app, { sejourId, membres, moi, recharger, depense = null }) {
  const dlg = app.querySelector('#dlgDepense');
  const parts = new Map((depense?.depense_parts || []).map(p => [p.user_id, p.part_centimes]));
  const concernes = depense ? new Set([...parts].filter(([, v]) => v > 0).map(([k]) => k)) : new Set(membres.map(m => m.user_id));
  const valeurs = depense ? [...parts.values()].filter(v => v > 0) : [];
  const libre = depense && valeurs.length && Math.max(...valeurs) - Math.min(...valeurs) > 1;
  dlg.innerHTML = `
    <form novalidate>
      <h2>${depense ? 'Modifier la dépense' : 'Nouvelle dépense'}</h2>
      <label for="dDesc">Quoi ?</label>
      <input id="dDesc" name="description" maxlength="120" placeholder="Ex. : Courses du marché" value="${esc(depense?.description || '')}">
      <div class="deux">
        <div><label for="dMontant">Montant (€)</label>
          <input id="dMontant" name="montant" inputmode="decimal" required placeholder="0,00" value="${depense ? versSaisie(depense.montant_centimes) : ''}"></div>
        <div><label for="dJour">Date</label>
          <input id="dJour" name="jour" type="date" value="${esc(depense?.jour || aujourdhui())}"></div>
      </div>
      <label for="dPayeur">Payé par</label>
      <select id="dPayeur" name="payeur">${membres.map(m => `
        <option value="${m.user_id}" ${(depense ? depense.paye_par : moi) === m.user_id ? 'selected' : ''}>${esc(m.prenom)}${m.user_id === moi ? ' (toi)' : ''}</option>`).join('')}</select>
      <fieldset class="partage">
        <legend>Partage</legend>
        <div class="onglets" role="radiogroup">
          <button type="button" role="radio" data-mode="egal" aria-selected="${!libre}">Parts égales</button>
          <button type="button" role="radio" data-mode="libre" aria-selected="${!!libre}">Montants libres</button>
        </div>
        <ul class="liste parts">${membres.map(m => `
          <li class="part" data-user="${m.user_id}">
            <label class="case-part"><input type="checkbox" ${concernes.has(m.user_id) ? 'checked' : ''}> ${esc(m.prenom)}</label>
            <span class="part-egale"></span>
            <input class="part-libre" inputmode="decimal" placeholder="0,00" aria-label="Part de ${esc(m.prenom)}"
              value="${parts.get(m.user_id) ? versSaisie(parts.get(m.user_id)) : ''}">
          </li>`).join('')}</ul>
        <p class="info" id="resteParts"></p>
      </fieldset>
      <p class="erreur" role="alert"></p>
      <div class="actions-dialogue">
        <button class="btn secondaire" type="button" id="annulerDepense">Annuler</button>
        <button class="btn" type="submit">${depense ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>`;

  const form = dlg.querySelector('form');
  let mode = libre ? 'libre' : 'egal';
  const lignes = [...form.querySelectorAll('.part')];

  function calculer() {
    const montant = versCentimes(form.montant.value);
    form.querySelector('.partage').dataset.mode = mode;
    form.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    const reste = form.querySelector('#resteParts');
    if (mode === 'egal') {
      const ids = lignes.filter(l => l.querySelector('[type=checkbox]').checked).map(l => l.dataset.user);
      const r = montant > 0 && ids.length ? new Map(partsEgales(montant, ids).map(p => [p.user_id, p.part])) : new Map();
      lignes.forEach(l => { l.querySelector('.part-egale').textContent = r.has(l.dataset.user) ? euros(r.get(l.dataset.user)) : ''; });
      reste.textContent = ids.length ? '' : 'Coche au moins une personne.';
      return { ids, parts: [...r].map(([user_id, part]) => ({ user_id, part })), montant };
    }
    const saisies = lignes.map(l => ({ user_id: l.dataset.user, part: versCentimes(l.querySelector('.part-libre').value || '0') }));
    const somme = saisies.reduce((t, p) => t + (Number.isFinite(p.part) ? p.part : 0), 0);
    const ecart = (montant || 0) - somme;
    reste.textContent = ecart === 0 ? 'Le compte est bon.' : ecart > 0 ? `Reste à répartir : ${euros(ecart)}` : `Trop réparti de ${euros(-ecart)}`;
    return { parts: saisies.filter(p => p.part > 0), somme, saisies, montant };
  }

  form.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; calculer(); });
  form.addEventListener('input', () => { form.querySelector('.erreur').textContent = ''; calculer(); });
  dlg.querySelector('#annulerDepense').onclick = () => dlg.close();
  calculer();

  form.onsubmit = e => {
    e.preventDefault();
    const err = form.querySelector('.erreur');
    const c = calculer();
    if (!(c.montant > 0)) { err.textContent = 'Indique un montant.'; return; }
    if (mode === 'egal' && !c.ids.length) { err.textContent = 'Coche au moins une personne concernée.'; return; }
    if (mode === 'libre') {
      if (c.saisies.some(p => !Number.isFinite(p.part) || p.part < 0)) { err.textContent = 'Une part n’est pas un montant valide.'; return; }
      if (c.somme !== c.montant) { err.textContent = 'La somme des parts doit être égale au montant.'; return; }
    }
    pendant(form, async () => {
      const { error } = await sb.rpc('enregistrer_depense', {
        p_sejour: sejourId, p_id: depense?.id || null, p_type: 'depense',
        p_description: form.description.value.trim() || null, p_montant: c.montant,
        p_paye_par: form.payeur.value, p_jour: form.jour.value || aujourdhui(), p_parts: c.parts,
      });
      if (error) throw error;
      dlg.close();
      toast(depense ? 'Dépense modifiée.' : 'Dépense ajoutée.');
      recharger();
    });
  };
  dlg.showModal();
}

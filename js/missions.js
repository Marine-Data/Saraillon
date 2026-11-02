// Planya — missions secrètes.
// Chaque jour du séjour, une mission secrète visant un autre membre (tirée au sort par la base).
// Pendant le séjour, seule la personne voit sa mission ; le dernier jour, chacun découvre
// les missions dont il a été la cible. Règles d'accès : sql/008_missions.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller, dateFr } from './outils.js';

const BUCKET = 'planya-missions';
const TAILLE_MAX = 10 * 1024 * 1024;
const jourCourt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const aujourdhuiParis = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());

async function charger(sejourId) {
  const [s, m, mission, toutes, points] = await Promise.all([
    sb.from('sejours').select('id, nom, debut, fin').eq('id', sejourId).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom').eq('sejour_id', sejourId),
    sb.rpc('ma_mission_du_jour', { p_sejour: sejourId }),
    sb.from('missions_secretes').select('*').eq('sejour_id', sejourId).order('jour', { ascending: false }),
    sb.rpc('missions_reussies', { p_sejour: sejourId }),
  ]);
  const erreur = s.error || m.error || mission.error || toutes.error || points.error;
  if (erreur) throw erreur;
  const visibles = toutes.data || [];
  let photos = new Map();
  const chemins = visibles.map(x => x.photo_chemin).filter(Boolean);
  if (chemins.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(chemins, 3600);
    photos = new Map((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
  return { sejour: s.data, membres: m.data || [], mission: (mission.data || [])[0] || null, visibles, points: points.data || [], photos };
}

export async function ecranMissions(app, sejourId, session) {
  app.innerHTML = '<p class="chargement">Chargement de ta mission…</p>';
  const moi = session.user.id;
  let d;
  try { d = await charger(sejourId); }
  catch (e) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e))}</p>`; return; }
  const { sejour, membres, mission, visibles, points, photos } = d;
  if (!sejour) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }

  const prenom = id => membres.find(m => m.user_id === id)?.prenom || 'Ancien membre';
  const recharger = () => ecranMissions(app, sejourId, session);
  const aujourdhui = aujourdhuiParis();
  const termine = sejour.fin && sejour.fin <= aujourdhui;
  const mesAnciennes = visibles.filter(x => x.user_id === moi && x.id !== mission?.id);
  const surMoi = visibles.filter(x => x.cible_id === moi && x.user_id !== moi);
  const classement = membres.map(m => ({ ...m, n: Number(points.find(p => p.user_id === m.user_id)?.reussies || 0) }))
    .sort((a, b) => b.n - a.n || a.prenom.localeCompare(b.prenom, 'fr'));

  let blocMission;
  if (!mission) {
    blocMission = sejour.debut && aujourdhui < sejour.debut
      ? `<p class="info">Les missions commencent le premier jour du séjour, le ${esc(dateFr(sejour.debut))}.</p>`
      : sejour.fin && aujourdhui > sejour.fin
        ? '<p class="info">Le séjour est terminé : plus de nouvelles missions.</p>'
        : membres.length < 2 ? '<p class="info">Il faut au moins deux membres dans le séjour pour recevoir une mission.</p>'
          : '<p class="info">Pas de mission pour l’instant.</p>';
  } else if (mission.faite) {
    blocMission = `<p class="mission-texte">${mission.type === 'info' ? '🔍' : '💌'} ${esc(mission.texte)}</p>
      <p class="succes">🕵️ Mission accomplie ! Reviens demain pour une nouvelle mission.</p>`;
  } else {
    blocMission = `
      <p class="mission-texte">${mission.type === 'info' ? '🔍' : '💌'} ${esc(mission.texte)}</p>
      <p class="meta">Reste discret ou discrète : la personne ne doit pas se douter que c’est une mission.</p>
      <form id="formMission" novalidate>
        ${mission.type === 'info' ? `
          <label for="reponse">Ta découverte</label>
          <textarea id="reponse" name="reponse" rows="2" maxlength="500" required></textarea>`
        : `
          <label class="btn secondaire depot">📷 Ajouter la preuve en photo
            <input type="file" name="photo" accept="image/*" hidden></label>
          <p class="info" id="nomPhoto"></p>
          <label for="reponse">Un mot sur ce que tu as fait (facultatif si tu as une photo)</label>
          <textarea id="reponse" name="reponse" rows="2" maxlength="500"></textarea>`}
        <p class="erreur" role="alert"></p>
        <button class="btn" type="submit">Valider ma mission</button>
      </form>`;
  }

  const carteRevelation = x => `
    <li class="revelation">
      <p><strong>${esc(prenom(x.user_id))}</strong> · ${esc(jourCourt(x.jour))}</p>
      <p class="mission-texte">${x.type === 'info' ? '🔍' : '💌'} ${esc(x.texte)}</p>
      ${x.reponse ? `<p>« ${esc(x.reponse)} »</p>` : ''}
      ${x.photo_chemin && photos.has(x.photo_chemin) ? `<img src="${esc(photos.get(x.photo_chemin))}" alt="Preuve de la mission" loading="lazy">` : ''}
    </li>`;

  app.innerHTML = `
    <button class="lien retour" id="retour">← ${esc(sejour.nom)}</button>
    <h1>Missions secrètes</h1>
    <p class="info">🔒 Ta mission n’est visible que par toi. Le dernier jour du séjour, chacun découvre les missions dont il a été la cible.</p>

    <section class="carte mission">
      <h2>Mission du jour</h2>
      ${blocMission}
    </section>

    ${termine ? `
    <section class="carte">
      <h2>🎁 Les missions qui te visaient</h2>
      ${surMoi.length ? `<ul class="liste">${surMoi.map(carteRevelation).join('')}</ul>` : '<p class="info">Aucune mission réussie ne te visait.</p>'}
    </section>` : ''}

    <section class="carte">
      <h2>Missions réussies</h2>
      <ul class="liste">${classement.map((m, i) => `
        <li class="membre"><span>${i < 3 && m.n ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${esc(m.prenom)}${m.user_id === moi ? ' <em>(toi)</em>' : ''}</span><strong>${m.n}</strong></li>`).join('')}</ul>
    </section>

    ${mesAnciennes.length ? `
    <details class="carte depliable">
      <summary>Mes missions précédentes</summary>
      <ul class="liste">${mesAnciennes.map(x => `
        <li class="revelation">
          <p class="meta">${esc(jourCourt(x.jour))} · ${x.faite ? '✅ réussie' : 'pas faite'}</p>
          <p>${esc(x.texte)}</p>${x.reponse ? `<p>« ${esc(x.reponse)} »</p>` : ''}
        </li>`).join('')}</ul>
    </details>` : ''}`;

  app.querySelector('#retour').onclick = () => aller('#/sejour/' + sejourId);
  const form = app.querySelector('#formMission');
  if (!form) return;
  const champPhoto = form.photo;
  if (champPhoto) champPhoto.onchange = () => { app.querySelector('#nomPhoto').textContent = champPhoto.files[0] ? '📎 ' + champPhoto.files[0].name : ''; };
  form.onsubmit = e => {
    e.preventDefault();
    const reponse = form.reponse.value.trim();
    const fichier = champPhoto?.files[0];
    const err = form.querySelector('.erreur');
    if (mission.type === 'info' && !reponse) { err.textContent = 'Écris ce que tu as découvert.'; return; }
    if (mission.type === 'action' && !reponse && !fichier) { err.textContent = 'Ajoute une photo ou un mot.'; return; }
    if (fichier && fichier.size > TAILLE_MAX) { err.textContent = 'Photo trop lourde : 10 Mo maximum.'; return; }
    pendant(form, async () => {
      let photo_chemin = null;
      if (fichier) {
        const ext = (fichier.name.match(/\.\w+$/) || ['.jpg'])[0].toLowerCase();
        photo_chemin = `${sejourId}/${moi}/${mission.id}-${Date.now()}${ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(photo_chemin, fichier, { contentType: fichier.type || undefined });
        if (error) throw error;
      }
      const { error } = await sb.from('missions_secretes')
        .update({ reponse: reponse || null, faite: true, ...(photo_chemin ? { photo_chemin } : {}) }).eq('id', mission.id);
      if (error) throw error;
      toast('🕵️ Mission accomplie !');
      recharger();
    });
  };
}

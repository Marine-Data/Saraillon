// Planya — comptes, séjours et invitations.
// Toutes les règles d'accès sont dans la base (sql/001_sejours.sql) : l'interface ne fait
// qu'afficher ce que la base accepte de renvoyer à la personne connectée.
import { sb } from './supabase.js';
import { esc, toast, dateFr, periode, messageErreur, pendant, aller, adresseRetour } from './outils.js';
import { ecranPlanning } from './planning.js';
import { ecranDepenses } from './depenses.js';
import { ecranCourses } from './courses.js';
import { ecranCorvees } from './corvees.js';
const app = document.getElementById('app');
const btnDeconnexion = document.getElementById('deconnexion');

let session = null;
let enRecuperation = false; // lien « mot de passe oublié » ouvert



// ---------- Écrans ----------
function ecranConnexion(onglet = 'connexion') {
  const inscription = onglet === 'inscription';
  app.innerHTML = `
    <h1>Vos vacances, organisées à plusieurs</h1>
    <p class="intro">Planning, défis, repas et souvenirs, dans un espace réservé au groupe.</p>
    <div class="onglets" role="tablist">
      <button role="tab" aria-selected="${!inscription}" data-onglet="connexion">Se connecter</button>
      <button role="tab" aria-selected="${inscription}" data-onglet="inscription">Créer un compte</button>
    </div>
    <form class="carte" id="formAuth" novalidate>
      <label for="email">Adresse e-mail</label>
      <input id="email" type="email" autocomplete="email" required>
      <label for="mdp">Mot de passe${inscription ? ' (8 caractères minimum)' : ''}</label>
      <input id="mdp" type="password" autocomplete="${inscription ? 'new-password' : 'current-password'}" minlength="8" required>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">${inscription ? 'Créer mon compte' : 'Se connecter'}</button>
      ${inscription ? '' : '<button class="lien" type="button" id="oubli">Mot de passe oublié ?</button>'}
    </form>`;
  app.querySelectorAll('[data-onglet]').forEach(b => b.onclick = () => ecranConnexion(b.dataset.onglet));
  const form = app.querySelector('#formAuth');
  form.onsubmit = e => {
    e.preventDefault();
    const email = form.email.value.trim(), mdp = form.mdp.value;
    if (!email || mdp.length < 8) { form.querySelector('.erreur').textContent = 'Entre ton e-mail et un mot de passe de 8 caractères minimum.'; return; }
    pendant(form, async () => {
      if (inscription) {
        const { data, error } = await sb.auth.signUp({ email, password: mdp, options: { emailRedirectTo: adresseRetour() } });
        if (error) throw error;
        if (!data.session) {
          app.innerHTML = `<div class="carte"><h2>Vérifie ta boîte mail</h2>
            <p>Un lien de confirmation a été envoyé à <strong>${esc(email)}</strong>. Clique dessus, puis reviens te connecter ici.</p>
            <button class="btn secondaire" id="retourConnexion">Retour à la connexion</button></div>`;
          app.querySelector('#retourConnexion').onclick = () => ecranConnexion('connexion');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
        if (error) throw error;
      }
    });
  };
  const oubli = app.querySelector('#oubli');
  if (oubli) oubli.onclick = async () => {
    const email = form.email.value.trim();
    if (!email) { form.querySelector('.erreur').textContent = 'Entre d’abord ton adresse e-mail.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: adresseRetour() });
    if (error) { form.querySelector('.erreur').textContent = messageErreur(error); return; }
    toast('Si un compte existe, un lien de réinitialisation vient d’être envoyé.');
  };
}

function ecranNouveauMotDePasse() {
  app.innerHTML = `
    <form class="carte" id="formMdp" novalidate>
      <h2>Nouveau mot de passe</h2>
      <label for="mdp">Mot de passe (8 caractères minimum)</label>
      <input id="mdp" type="password" autocomplete="new-password" minlength="8" required>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Enregistrer</button>
    </form>`;
  const form = app.querySelector('#formMdp');
  form.onsubmit = e => {
    e.preventDefault();
    if (form.mdp.value.length < 8) { form.querySelector('.erreur').textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
    pendant(form, async () => {
      const { error } = await sb.auth.updateUser({ password: form.mdp.value });
      if (error) throw error;
      enRecuperation = false; toast('Mot de passe modifié.'); aller('#/'); router();
    });
  };
}

async function ecranMesSejours() {
  app.innerHTML = '<p class="chargement">Chargement de vos séjours…</p>';
  const { data, error } = await sb.from('sejour_membres')
    .select('role, prenom, sejours (id, nom, lieu, debut, fin)')
    .eq('user_id', session.user.id)
    .order('rejoint_le', { ascending: false });
  if (error) { app.innerHTML = `<p class="erreur">${esc(messageErreur(error))}</p>`; return; }
  const liste = (data || []).filter(m => m.sejours);
  app.innerHTML = `
    <h1>Mes séjours</h1>
    ${liste.length ? `<ul class="liste">${liste.map(m => `
      <li><button class="sejour" data-id="${m.sejours.id}">
        <div><strong>${esc(m.sejours.nom)}</strong>
          <span>${esc([m.sejours.lieu, periode(m.sejours)].filter(Boolean).join(' · '))}</span></div>
        <span class="badge ${m.role === 'organisateur' ? 'orga' : ''}">${m.role === 'organisateur' ? 'Organisation' : 'Membre'}</span>
      </button></li>`).join('')}</ul>`
      : '<p class="vide">Aucun séjour pour l’instant. Crée le premier ou rejoins celui d’un ami avec son code.</p>'}
    <button class="btn" id="creer">Créer un séjour</button>
    <button class="btn secondaire" id="rejoindre">Rejoindre avec un code</button>`;
  app.querySelectorAll('[data-id]').forEach(b => b.onclick = () => aller('#/sejour/' + b.dataset.id));
  app.querySelector('#creer').onclick = () => aller('#/creer');
  app.querySelector('#rejoindre').onclick = () => aller('#/rejoindre');
}

function ecranCreer() {
  app.innerHTML = `
    <button class="lien retour" id="retour">← Mes séjours</button>
    <form class="carte" id="formCreer" novalidate>
      <h2>Créer un séjour</h2>
      <label for="nom">Nom du séjour</label>
      <input id="nom" maxlength="80" placeholder="Ex. : Vacances à la mer 2027" required>
      <label for="lieu">Lieu (facultatif)</label>
      <input id="lieu" maxlength="120">
      <div class="deux">
        <div><label for="debut">Début</label><input id="debut" type="date"></div>
        <div><label for="fin">Fin</label><input id="fin" type="date"></div>
      </div>
      <label for="prenom">Ton prénom dans ce séjour</label>
      <input id="prenom" maxlength="40" autocomplete="given-name" required>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Créer</button>
    </form>`;
  app.querySelector('#retour').onclick = () => aller('#/');
  const form = app.querySelector('#formCreer');
  form.onsubmit = e => {
    e.preventDefault();
    const v = k => form[k].value.trim();
    if (!v('nom') || !v('prenom')) { form.querySelector('.erreur').textContent = 'Le nom du séjour et ton prénom sont obligatoires.'; return; }
    if (v('debut') && v('fin') && v('fin') < v('debut')) { form.querySelector('.erreur').textContent = 'La fin doit être après le début.'; return; }
    pendant(form, async () => {
      const { data, error } = await sb.rpc('creer_sejour', {
        p_nom: v('nom'), p_lieu: v('lieu') || null, p_debut: v('debut') || null, p_fin: v('fin') || null, p_prenom: v('prenom'),
      });
      if (error) throw error;
      toast('Séjour créé. Partage le code pour inviter le groupe.');
      aller('#/sejour/' + data);
    });
  };
}

function ecranRejoindre() {
  app.innerHTML = `
    <button class="lien retour" id="retour">← Mes séjours</button>
    <form class="carte" id="formRejoindre" novalidate>
      <h2>Rejoindre un séjour</h2>
      <p class="info">Demande le code d’invitation à la personne qui organise.</p>
      <label for="code">Code d’invitation</label>
      <input id="code" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" required>
      <label for="prenom">Ton prénom dans ce séjour</label>
      <input id="prenom" maxlength="40" autocomplete="given-name" required>
      <p class="erreur" role="alert"></p>
      <button class="btn" type="submit">Rejoindre</button>
    </form>`;
  app.querySelector('#retour').onclick = () => aller('#/');
  const form = app.querySelector('#formRejoindre');
  form.onsubmit = e => {
    e.preventDefault();
    const code = form.code.value.trim(), prenom = form.prenom.value.trim();
    if (!code || !prenom) { form.querySelector('.erreur').textContent = 'Le code et ton prénom sont obligatoires.'; return; }
    pendant(form, async () => {
      const { data, error } = await sb.rpc('rejoindre_sejour', { p_code: code, p_prenom: prenom });
      if (error) throw error;
      if (!data) { form.querySelector('.erreur').textContent = 'Code inconnu. Vérifie-le auprès de la personne qui organise.'; return; }
      toast('Bienvenue dans le séjour !');
      aller('#/sejour/' + data);
    });
  };
}

async function ecranSejour(id) {
  app.innerHTML = '<p class="chargement">Chargement du séjour…</p>';
  const [{ data: s, error: e1 }, { data: membres, error: e2 }] = await Promise.all([
    sb.from('sejours').select('*').eq('id', id).maybeSingle(),
    sb.from('sejour_membres').select('user_id, prenom, role').eq('sejour_id', id).order('rejoint_le'),
  ]);
  if (e1 || e2) { app.innerHTML = `<p class="erreur">${esc(messageErreur(e1 || e2))}</p>`; return; }
  if (!s) { toast('Ce séjour n’existe pas ou tu n’en fais pas partie.'); aller('#/'); return; }
  const moi = (membres || []).find(m => m.user_id === session.user.id);
  const orga = moi?.role === 'organisateur';
  app.innerHTML = `
    <button class="lien retour" id="retour">← Mes séjours</button>
    <h1>${esc(s.nom)}</h1>
    <p class="intro">${esc([s.lieu, periode(s)].filter(Boolean).join(' · ')) || '&nbsp;'}</p>

    <section class="carte">
      <h2>Inviter le groupe</h2>
      <p class="info">Partage ce code : chaque personne crée son compte, puis choisit « Rejoindre avec un code ».</p>
      <div class="code" id="code">${esc(s.code_invitation)}</div>
      <button class="btn secondaire" id="partager">Partager le code</button>
      ${orga ? '<button class="lien" id="nouveauCode">Générer un nouveau code (l’ancien ne marchera plus)</button>' : ''}
    </section>

    <section class="carte">
      <h2>Membres (${membres.length})</h2>
      <ul class="liste">${membres.map(m => `
        <li class="membre">
          <span>${esc(m.prenom)}${m.user_id === session.user.id ? ' <em>(toi)</em>' : ''}</span>
          <span>${m.role === 'organisateur' ? '<span class="badge orga">Organisation</span>'
            : orga ? `<button class="lien" data-retirer="${m.user_id}" data-prenom="${esc(m.prenom)}">Retirer</button>` : ''}</span>
        </li>`).join('')}</ul>
      <button class="lien" id="renommer">Changer mon prénom</button>
    </section>

    <section class="carte">
      <h2>Le séjour</h2>
      <button class="btn" id="ouvrirPlanning">🗓️ Planning</button>
      <button class="btn" id="ouvrirDepenses">💰 Dépenses</button>
      <button class="btn" id="ouvrirCourses">🛒 Courses</button>
      <button class="btn" id="ouvrirCorvees">🧹 Corvées</button>
      <p class="info">Bientôt : valise, défis et jeux, chat et souvenirs.</p>
    </section>

    ${orga ? '<button class="btn danger" id="supprimer">Supprimer le séjour</button>'
           : '<button class="btn danger" id="quitter">Quitter le séjour</button>'}`;

  app.querySelector('#retour').onclick = () => aller('#/');
  app.querySelector('#ouvrirPlanning').onclick = () => aller('#/sejour/' + id + '/planning');
  app.querySelector('#ouvrirDepenses').onclick = () => aller('#/sejour/' + id + '/depenses');
  app.querySelector('#ouvrirCourses').onclick = () => aller('#/sejour/' + id + '/courses');
  app.querySelector('#ouvrirCorvees').onclick = () => aller('#/sejour/' + id + '/corvees');
  app.querySelector('#partager').onclick = async () => {
    const texte = `Rejoins le séjour « ${s.nom} » sur Planya : ${adresseRetour()} — code d’invitation : ${s.code_invitation}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Planya', text: texte });
      else { await navigator.clipboard.writeText(texte); toast('Invitation copiée.'); }
    } catch (e) { /* partage annulé */ }
  };
  const nouveau = app.querySelector('#nouveauCode');
  if (nouveau) nouveau.onclick = async () => {
    if (!confirm('Générer un nouveau code ? L’ancien ne permettra plus de rejoindre le séjour.')) return;
    const { data, error } = await sb.rpc('nouveau_code_invitation', { p_sejour: id });
    if (error) { toast(messageErreur(error)); return; }
    app.querySelector('#code').textContent = data; toast('Nouveau code généré.');
  };
  app.querySelectorAll('[data-retirer]').forEach(b => b.onclick = async () => {
    if (!confirm(`Retirer ${b.dataset.prenom} du séjour ?`)) return;
    const { error } = await sb.from('sejour_membres').delete().eq('sejour_id', id).eq('user_id', b.dataset.retirer);
    if (error) { toast(messageErreur(error)); return; }
    toast(`${b.dataset.prenom} a été retiré·e.`); ecranSejour(id);
  });
  app.querySelector('#renommer').onclick = async () => {
    const p = prompt('Ton prénom dans ce séjour :', moi?.prenom || '');
    if (p === null || !p.trim()) return;
    const { error } = await sb.from('sejour_membres').update({ prenom: p.trim().slice(0, 40) })
      .eq('sejour_id', id).eq('user_id', session.user.id);
    if (error) { toast(messageErreur(error)); return; }
    ecranSejour(id);
  };
  const quitter = app.querySelector('#quitter');
  if (quitter) quitter.onclick = async () => {
    if (!confirm('Quitter ce séjour ? Tu pourras revenir avec le code d’invitation.')) return;
    const { error } = await sb.from('sejour_membres').delete().eq('sejour_id', id).eq('user_id', session.user.id);
    if (error) { toast(messageErreur(error)); return; }
    toast('Tu as quitté le séjour.'); aller('#/');
  };
  const supprimer = app.querySelector('#supprimer');
  if (supprimer) supprimer.onclick = async () => {
    const saisie = prompt(`Supprimer définitivement « ${s.nom} » et tout son contenu ?\nTape le nom du séjour pour confirmer.`);
    if (saisie === null) return;
    if (saisie.trim() !== s.nom) { toast('Le nom ne correspond pas : rien n’a été supprimé.'); return; }
    const { error } = await sb.from('sejours').delete().eq('id', id);
    if (error) { toast(messageErreur(error)); return; }
    toast('Séjour supprimé.'); aller('#/');
  };
}

// ---------- Installation ----------
// Le bouton « Installer » est visible sur tous les écrans tant que l'appli n'est pas installée.
// Si le navigateur propose l'installation directe (Chrome, Edge, Samsung Internet), on l'utilise ;
// sinon on affiche la marche à suivre adaptée au navigateur détecté.
let invitationInstall = null;
const btnInstaller = document.getElementById('installer');
const barreAppli = document.getElementById('barreAppli');
const dlgInstall = document.getElementById('dlgInstall');
const dejaInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function navigateur() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  if (/FBAN|FBAV|Instagram|WhatsApp|Snapchat|Line\/|LinkedInApp|TikTok|Messenger|; wv\)/i.test(ua)) return 'integre';
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-autre' : 'ios-safari';
  if (android) {
    if (/Firefox/i.test(ua)) return 'android-firefox';
    if (/SamsungBrowser/i.test(ua)) return 'android-samsung';
    return 'android-chrome';
  }
  if (/Firefox/i.test(ua)) return 'pc-firefox';
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)) return 'pc-safari';
  return 'pc-chrome';
}

const ETAPES = {
  'ios-safari': ['Ouvre ce lien dans <strong>Safari</strong> (depuis WhatsApp : <strong>⋯</strong> puis « Ouvrir dans Safari »).',
    'Touche le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut), en bas de l’écran.',
    'Descends et choisis <strong>« Sur l’écran d’accueil »</strong>.', 'Touche <strong>Ajouter</strong>.'],
  'ios-autre': ['Touche le bouton <strong>Partager</strong> (le carré avec une flèche), dans la barre d’adresse ou le menu.',
    'Choisis <strong>« Sur l’écran d’accueil »</strong>.', 'Touche <strong>Ajouter</strong>. Si l’option n’existe pas, ouvre Planya dans <strong>Safari</strong>.'],
  'android-chrome': ['Ouvre ce lien dans <strong>Chrome</strong> (depuis WhatsApp : <strong>⋮</strong> puis « Ouvrir dans Chrome »).',
    'Touche le menu <strong>⋮</strong> en haut à droite.',
    'Choisis <strong>« Installer l’application »</strong> ou <strong>« Ajouter à l’écran d’accueil »</strong>.',
    'Ouvre ensuite <strong>Planya</strong> depuis ton écran d’accueil.'],
  'android-firefox': ['Touche le menu <strong>⋮</strong> (en haut ou en bas à droite).',
    'Choisis <strong>« Ajouter à l’écran d’accueil »</strong> ou <strong>« Installer »</strong>.', 'Confirme.'],
  'android-samsung': ['Touche le menu <strong>≡</strong> en bas à droite.',
    'Choisis <strong>« Ajouter la page à »</strong>, puis <strong>« Écran d’accueil »</strong>.', 'Confirme.'],
  'integre': ['Tu es dans le navigateur intégré d’une autre appli, qui ne permet pas d’installer.',
    'Ouvre le menu (<strong>⋮</strong> ou <strong>…</strong>) et choisis <strong>« Ouvrir dans le navigateur »</strong>, ou copie le lien ci-dessous.',
    'Dans ton navigateur, touche à nouveau <strong>Installer</strong>.'],
  'pc-chrome': ['Clique sur l’icône d’installation (un écran avec une flèche) à droite de la barre d’adresse.',
    'Ou ouvre le menu <strong>⋮</strong>, puis <strong>« Installer Planya »</strong>.'],
  'pc-safari': ['Ouvre le menu <strong>Fichier</strong>, puis <strong>« Ajouter au Dock »</strong>.'],
  'pc-firefox': ['Firefox sur ordinateur ne permet pas d’installer d’application web.',
    'Ouvre Planya dans <strong>Chrome</strong> ou <strong>Edge</strong> pour l’installer, ou garde simplement ce lien en favori.'],
};

function afficherInstallation() {
  barreAppli.hidden = dejaInstallee();
}
function ouvrirInstructions() {
  const nav = navigateur();
  dlgInstall.querySelector('#etapesInstall').innerHTML = ETAPES[nav].map(e => `<li>${e}</li>`).join('');
  dlgInstall.querySelector('#copierLien').hidden = nav !== 'integre';
  dlgInstall.showModal();
}
btnInstaller.onclick = async () => {
  if (invitationInstall) {
    invitationInstall.prompt();
    await invitationInstall.userChoice;
    invitationInstall = null;
    afficherInstallation();
  } else ouvrirInstructions();
};
dlgInstall.querySelector('#fermerInstall').onclick = () => dlgInstall.close();
dlgInstall.querySelector('#copierLien').onclick = async () => {
  try { await navigator.clipboard.writeText(adresseRetour()); toast('Lien copié : colle-le dans ton navigateur.'); }
  catch (e) { toast(adresseRetour()); }
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invitationInstall = e; afficherInstallation(); });
window.addEventListener('appinstalled', () => { invitationInstall = null; afficherInstallation(); toast('Planya est installée.'); });
matchMedia('(display-mode: standalone)').addEventListener?.('change', afficherInstallation);
afficherInstallation();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Navigation ----------
function router() {
  btnDeconnexion.hidden = !session;
  if (enRecuperation) return ecranNouveauMotDePasse();
  if (!session) return ecranConnexion();
  const h = location.hash;
  const p = h.match(/^#\/sejour\/([0-9a-f-]{36})\/planning$/);
  if (p) return ecranPlanning(app, p[1], session);
  const d = h.match(/^#\/sejour\/([0-9a-f-]{36})\/depenses$/);
  if (d) return ecranDepenses(app, d[1], session);
  const c = h.match(/^#\/sejour\/([0-9a-f-]{36})\/courses(?:\/([0-9a-f-]{36}))?$/);
  if (c) return ecranCourses(app, c[1], session, { repasId: c[2] || null });
  const v = h.match(/^#\/sejour\/([0-9a-f-]{36})\/corvees$/);
  if (v) return ecranCorvees(app, v[1], session);
  const m = h.match(/^#\/sejour\/([0-9a-f-]{36})$/);
  if (m) return ecranSejour(m[1]);
  if (h === '#/creer') return ecranCreer();
  if (h === '#/rejoindre') return ecranRejoindre();
  return ecranMesSejours();
}

btnDeconnexion.onclick = async () => { await sb.auth.signOut(); aller('#/'); };
window.addEventListener('hashchange', router);
sb.auth.onAuthStateChange((evenement, s) => {
  session = s;
  if (evenement === 'PASSWORD_RECOVERY') enRecuperation = true;
  router();
});

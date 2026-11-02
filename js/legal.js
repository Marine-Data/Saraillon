// Planya — mentions légales, politique de confidentialité, et « Mon compte »
// (télécharger ses données, supprimer son compte). Règles côté base : sql/010_comptes.sql.
import { sb } from './supabase.js';
import { esc, toast, messageErreur, pendant, aller } from './outils.js';
import { CONTACT_EMAIL } from './config.js';
import { TYPES, pushPossible, estInstallee, estIOS, abonnementActuel, activerNotifications, desactiverNotifications,
  lirePreferences, enregistrerPreference } from './notifications.js';

const MAJ = '2 novembre 2026';
const contact = () => CONTACT_EMAIL
  ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>`
  : '<em>adresse de contact en cours de création</em>';
const retour = session => `<button class="lien retour" id="retour">← ${session ? 'Mes séjours' : 'Accueil'}</button>`;

export function pageMentions(app, session) {
  app.innerHTML = `
    ${retour(session)}
    <article class="carte texte-legal">
      <h1>Mentions légales</h1>
      <h2>Éditrice</h2>
      <p>Planya est un projet personnel et non commercial, édité par Marine Zinzen, particulier.<br>
        Contact : ${contact()}<br>Directrice de la publication : Marine Zinzen.</p>
      <h2>Hébergement du site</h2>
      <p>Netlify, Inc., 101 2nd Street, San Francisco, CA 94105, États-Unis.</p>
      <h2>Hébergement des données</h2>
      <p>Supabase (base de données, comptes et fichiers), serveurs situés dans l’Union européenne (région Stockholm, Suède).</p>
      <h2>Code source</h2>
      <p>Le code de Planya est public : <a href="https://github.com/Marine-Data/Saraillon" target="_blank" rel="noopener">github.com/Marine-Data/Saraillon</a>.
        Polices Inter et Josefin Sans sous licence SIL Open Font License ; bibliothèque supabase-js sous licence MIT.</p>
      <p class="meta">Mise à jour : ${MAJ}.</p>
    </article>`;
  app.querySelector('#retour').onclick = () => aller('#/');
}

export function pageConfidentialite(app, session) {
  app.innerHTML = `
    ${retour(session)}
    <article class="carte texte-legal">
      <h1>Politique de confidentialité</h1>
      <p>Planya sert à organiser un séjour à plusieurs. Elle est conçue pour collecter le moins de données possible
        et pour que chaque séjour ne soit visible que par ses membres.</p>

      <h2>Qui est responsable de vos données ?</h2>
      <p>Marine Zinzen, éditrice de Planya (voir les <a href="#/mentions-legales">mentions légales</a>). Contact : ${contact()}.</p>

      <h2>Quelles données, pour quoi faire ?</h2>
      <ul>
        <li><strong>Votre compte</strong> : adresse e-mail et mot de passe (stocké sous forme chiffrée, illisible même pour l’éditrice). Pour vous connecter.</li>
        <li><strong>Votre prénom</strong>, choisi séjour par séjour. Pour que le groupe sache qui fait quoi.</li>
        <li><strong>Ce que vous saisissez dans un séjour</strong> : activités, commentaires, dépenses, courses, corvées, infos du logement, horaires de voyage, votes, réponses aux missions.</li>
        <li><strong>Vos fichiers</strong> : billets de transport et photos de missions.</li>
        <li><strong>Des données techniques</strong> : journaux de connexion (dont l’adresse IP) tenus par les hébergeurs, pour la sécurité du service.</li>
      </ul>
      <p>Ces données servent uniquement à faire fonctionner Planya. Base légale : l’exécution du service que vous demandez en créant un compte
        (article 6.1.b du RGPD) ; pour les journaux techniques, l’intérêt légitime à sécuriser le service (article 6.1.f).
        Aucune publicité, aucun profilage, aucune revente.</p>

      <h2>Qui peut les voir ?</h2>
      <ul>
        <li><strong>Les membres de votre séjour</strong>, et eux seuls, voient ce qui est partagé dans ce séjour.</li>
        <li><strong>Vous seul ou seule</strong> voyez votre valise, vos billets et votre mission secrète du jour. Les missions qui vous visaient
          vous sont révélées le dernier jour du séjour. Dans un sondage anonyme, personne ne peut savoir ce que vous avez voté.</li>
        <li><strong>Les prestataires techniques</strong>, qui hébergent sans exploiter : Supabase (base de données et fichiers, dans l’Union européenne),
          Netlify (site, États-Unis, adhérent au cadre de protection des données UE–États-Unis) et Brevo (envoi des e-mails de connexion, France).</li>
        <li><strong>Les notifications</strong>, si vous les activez, passent par le service de notification de votre navigateur
          (Google, Apple ou Mozilla). Leur contenu est chiffré : ces services ne peuvent pas le lire. Une notification n’est pas conservée
          une fois envoyée, et vous choisissez dans <a href="#/compte">Mon compte</a> ce que vous recevez.</li>
      </ul>
      <p>Ces règles sont appliquées par la base de données elle-même, pas seulement par l’affichage.</p>

      <h2>Combien de temps ?</h2>
      <p>Tant que votre compte existe. Quitter un séjour efface ce qui vous y concernait personnellement. Supprimer votre compte efface tout
        immédiatement ; vos fichiers sont effacés dans l’heure. Ce qui sert aussi au groupe (dépenses, activités, courses, sondages que vous avez créés)
        est conservé mais anonymisé : vous n’y apparaissez plus que comme « Ancien membre ».</p>

      <h2>Vos droits</h2>
      <p>Vous pouvez accéder à vos données, les corriger, les effacer, les récupérer, vous opposer à leur traitement ou en demander la limitation.
        Dans <a href="#/compte">Mon compte</a>, vous pouvez directement <strong>télécharger vos données</strong> et <strong>supprimer votre compte</strong>.
        Pour toute autre demande : ${contact()}. Vous pouvez aussi saisir la <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">CNIL</a>.</p>

      <h2>Cookies et traceurs</h2>
      <p>Aucun cookie publicitaire ni de mesure d’audience. Planya garde seulement votre session de connexion dans votre navigateur,
        ce qui est indispensable au service. Les polices et le code sont hébergés avec le site : aucune requête n’est envoyée à Google ou à un autre service tiers.</p>

      <p class="meta">Mise à jour : ${MAJ}.</p>
    </article>`;
  app.querySelector('#retour').onclick = () => aller('#/');
}

// ---------- Mon compte ----------
async function mesDonnees(moi) {
  const tables = [
    ['appartenances', sb.from('sejour_membres').select('sejour_id, prenom, role, rejoint_le, sejours(nom, lieu, debut, fin)').eq('user_id', moi)],
    ['activites_creees', sb.from('activites').select('sejour_id, jour, nom, lieu, notes, cree_le').eq('cree_par', moi)],
    ['commentaires', sb.from('activite_commentaires').select('sejour_id, texte, cree_le').eq('user_id', moi)],
    ['inscriptions', sb.from('activite_inscriptions').select('sejour_id, activite_id, inscrit_le').eq('user_id', moi)],
    ['depenses_payees', sb.from('depenses').select('sejour_id, type, description, montant_centimes, jour').eq('paye_par', moi)],
    ['mes_parts_de_depenses', sb.from('depense_parts').select('sejour_id, depense_id, part_centimes').eq('user_id', moi)],
    ['courses_ajoutees', sb.from('courses').select('sejour_id, texte, fait, cree_le').eq('cree_par', moi)],
    ['corvees', sb.from('corvee_attributions').select('sejour_id, jour, fait, liste_corvees(nom)').eq('user_id', moi)],
    ['trajets', sb.from('trajets').select('sejour_id, sens, jour, heure, lieu, note').eq('user_id', moi)],
    ['billets', sb.from('billets').select('sejour_id, nom_fichier, cree_le').eq('user_id', moi)],
    ['valise', sb.from('valise_objets').select('sejour_id, texte, perso, fait').eq('user_id', moi)],
    ['missions_secretes', sb.from('missions_secretes').select('sejour_id, jour, type, texte, reponse, faite').eq('user_id', moi)],
    ['votes', sb.from('sondage_votes').select('sejour_id, sondage_id, choix_id, vote_le').eq('user_id', moi)],
    ['sondages_crees', sb.from('sondages').select('sejour_id, question, anonyme, cree_le').eq('cree_par', moi)],
    ['publications', sb.from('fil_actu').select('sejour_id, texte, cree_le').eq('user_id', moi).eq('type', 'publication')],
    ['commentaires_fil', sb.from('fil_commentaires').select('sejour_id, texte, cree_le').eq('user_id', moi)],
    ['reglages_notifications', sb.from('preferences_notifications').select('publications, sondages, activites, depenses, matin').eq('user_id', moi)],
    ['appareils_notifications', sb.from('abonnements_push').select('cree_le').eq('user_id', moi)],
  ];
  const resultats = await Promise.all(tables.map(([, q]) => q));
  const erreur = resultats.find(r => r.error)?.error;
  if (erreur) throw erreur;
  return Object.fromEntries(tables.map(([nom], i) => [nom, resultats[i].data]));
}

export function ecranCompte(app, session) {
  const moi = session.user.id;
  app.innerHTML = `
    <button class="lien retour" id="retour">← Mes séjours</button>
    <h1>Mon compte</h1>
    <section class="carte">
      <h2>Adresse e-mail</h2>
      <p>${esc(session.user.email)}</p>
    </section>
    <section class="carte" id="carteNotifs">
      <h2>Notifications</h2>
      <p class="info" id="etatNotifs">…</p>
      <button class="btn" id="basculerNotifs" hidden></button>
      <fieldset class="partage" id="typesNotifs">
        <legend>Ce que tu reçois</legend>
        ${TYPES.map(([k, v]) => `<label class="case"><input type="checkbox" data-pref="${k}"> ${v}</label>`).join('')}
      </fieldset>
    </section>
    <section class="carte">
      <h2>Mes données</h2>
      <p class="info">Un fichier avec tout ce que Planya garde à ton sujet (format JSON, lisible par d’autres outils).</p>
      <button class="btn secondaire" id="telecharger">Télécharger mes données</button>
      <p class="info"><a href="#/confidentialite">Politique de confidentialité</a></p>
    </section>
    <form class="carte" id="formSuppression" novalidate>
      <h2>Supprimer mon compte</h2>
      <p>C’est définitif. Ton compte, tes prénoms, ta valise, tes billets, tes trajets, tes missions, tes votes et tes commentaires sont effacés.
        Ce qui sert aussi au groupe (dépenses, activités, courses, sondages que tu as créés) reste, mais anonymisé : tu y apparais comme « Ancien membre ».</p>
      <p>Si tu organises seul ou seule un séjour, l’organisation passe au membre le plus ancien ; si tu y es seul ou seule, le séjour est supprimé.</p>
      <label for="confirmation">Pour confirmer, écris SUPPRIMER</label>
      <input id="confirmation" name="confirmation" autocomplete="off" autocapitalize="characters">
      <p class="erreur" role="alert"></p>
      <button class="btn danger" type="submit">Supprimer définitivement mon compte</button>
    </form>`;
  app.querySelector('#retour').onclick = () => aller('#/');
  afficherNotifications(app, moi);

  const telecharger = app.querySelector('#telecharger');
  telecharger.onclick = async () => {
    telecharger.disabled = true;
    try {
      const donnees = { exporte_le: new Date().toISOString(), compte: { email: session.user.email, cree_le: session.user.created_at },
        ...(await mesDonnees(moi)) };
      const lien = document.createElement('a');
      lien.href = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
      lien.download = `planya-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(lien); lien.click(); lien.remove();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
    } catch (e) { toast(messageErreur(e)); }
    telecharger.disabled = false;
  };

  const form = app.querySelector('#formSuppression');
  form.onsubmit = e => {
    e.preventDefault();
    if (form.confirmation.value.trim().toUpperCase() !== 'SUPPRIMER') {
      form.querySelector('.erreur').textContent = 'Écris SUPPRIMER pour confirmer.'; return;
    }
    pendant(form, async () => {
      await desactiverNotifications().catch(() => {});
      const { error } = await sb.rpc('supprimer_mon_compte');
      if (error) throw error;
      await sb.auth.signOut({ scope: 'local' });
      toast('Ton compte a été supprimé.');
      aller('#/');
    });
  };
}

// ---------- Notifications de cet appareil ----------
async function afficherNotifications(app, moi) {
  const etat = app.querySelector('#etatNotifs');
  const bouton = app.querySelector('#basculerNotifs');
  const prefs = await lirePreferences(moi);
  app.querySelectorAll('[data-pref]').forEach(c => {
    c.checked = prefs[c.dataset.pref];
    c.onchange = async () => {
      try { await enregistrerPreference(moi, c.dataset.pref, c.checked); }
      catch (e) { c.checked = !c.checked; toast(messageErreur(e)); }
    };
  });
  if (estIOS() && !estInstallee()) {
    etat.textContent = 'Sur iPhone, les notifications ne marchent qu’une fois Planya installée sur l’écran d’accueil (bouton « Installer l’appli »).';
    return;
  }
  if (!pushPossible()) { etat.textContent = 'Ce navigateur ne permet pas les notifications.'; return; }
  const abo = await abonnementActuel().catch(() => null);
  const actives = !!abo && Notification.permission === 'granted';
  etat.textContent = actives ? '🔔 Activées sur cet appareil.'
    : Notification.permission === 'denied' ? 'Bloquées par le navigateur : autorise-les dans ses réglages, puis reviens ici.'
      : 'Désactivées sur cet appareil.';
  bouton.hidden = Notification.permission === 'denied' && !actives;
  bouton.textContent = actives ? 'Désactiver sur cet appareil' : '🔔 Activer les notifications';
  bouton.className = actives ? 'btn secondaire' : 'btn';
  bouton.onclick = async () => {
    bouton.disabled = true;
    try {
      if (actives) await desactiverNotifications(); else await activerNotifications();
      toast(actives ? 'Notifications désactivées sur cet appareil.' : '🔔 Notifications activées !');
    } catch (e) { toast(messageErreur(e)); }
    bouton.disabled = false;
    afficherNotifications(app, moi);
  };
}

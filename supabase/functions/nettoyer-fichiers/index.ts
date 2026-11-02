// Planya — efface les fichiers notés dans la table fichiers_a_effacer
// (billets et photos de missions de personnes parties ou supprimées).
// Appelée toutes les heures par la tâche planifiée « planya-nettoyer-fichiers » (sql/010_comptes.sql).
// Elle ne reçoit aucun paramètre et ne fait que vider cette file : l'appeler n'expose rien.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKETS = ['planya-billets', 'planya-missions'];

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: file, error } = await admin.from('fichiers_a_effacer').select('bucket, chemin').limit(500);
  if (error) return new Response(JSON.stringify({ erreur: error.message }), { status: 500 });

  let effaces = 0;
  for (const bucket of BUCKETS) {
    const chemins = (file ?? []).filter(f => f.bucket === bucket).map(f => f.chemin);
    if (!chemins.length) continue;
    const { error: e } = await admin.storage.from(bucket).remove(chemins);
    if (e) continue; // on réessaiera à la prochaine heure
    await admin.from('fichiers_a_effacer').delete().eq('bucket', bucket).in('chemin', chemins);
    effaces += chemins.length;
  }
  return new Response(JSON.stringify({ effaces }), { headers: { 'Content-Type': 'application/json' } });
});

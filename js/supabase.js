// Client Supabase unique, partagé par tous les modules.
import { createClient } from './vendor/supabase-js-2.45.0.min.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

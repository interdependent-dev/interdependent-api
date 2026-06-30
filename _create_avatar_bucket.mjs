// Create the public 'reader-avatars' storage bucket (idempotent).
//   node --env-file=.env _create_avatar_bucket.mjs
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data, error } = await db.storage.createBucket('reader-avatars', {
  public: true,
  fileSizeLimit: '3MB',
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
});
if (error && !/already exists|exists/i.test(error.message)) { console.log('✗ createBucket:', error.message); process.exit(1); }
console.log(error ? '= bucket already exists' : '✓ bucket created', data || '');

const { data: got, error: gErr } = await db.storage.getBucket('reader-avatars');
if (gErr) { console.log('✗ getBucket:', gErr.message); process.exit(1); }
console.log(`bucket 'reader-avatars' — public=${got.public}, sizeLimit=${got.file_size_limit}`);

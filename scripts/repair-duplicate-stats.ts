import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

type StatsRow = {
  user_id: number;
  total_posts: number | null;
  total_duplicates: number | null;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const shouldApply = process.argv.includes('--apply');

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY must be set.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('stats')
    .select('user_id,total_posts,total_duplicates')
    .order('total_duplicates', { ascending: false });

  if (error) {
    throw new Error(`Failed to read stats: ${error.message}`);
  }

  const rows = (data || []) as StatsRow[];
  const fixes = rows.filter((row) => (row.total_duplicates || 0) > (row.total_posts || 0));

  console.log(`Scanned ${rows.length} stats rows.`);
  console.log(`Found ${fixes.length} rows where duplicates exceed posts.`);

  if (!shouldApply) {
    if (fixes.length > 0) {
      const preview = fixes.slice(0, 10).map((row) => ({
        user_id: row.user_id,
        total_posts: row.total_posts || 0,
        total_duplicates: row.total_duplicates || 0,
        capped_to: row.total_posts || 0,
      }));
      console.log('Preview:', JSON.stringify(preview, null, 2));
    }
    console.log('Dry run only. Re-run with --apply to save changes.');
    return;
  }

  let updated = 0;
  for (const row of fixes) {
    const cappedValue = row.total_posts || 0;
    const { error: updateError } = await supabase
      .from('stats')
      .update({ total_duplicates: cappedValue })
      .eq('user_id', row.user_id);

    if (updateError) {
      throw new Error(`Failed to update user ${row.user_id}: ${updateError.message}`);
    }

    updated++;
  }

  console.log(`Updated ${updated} rows.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

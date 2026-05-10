/**
 * Tech Name Normalization Script
 * Merges variant tech names into canonical names using fuzzy matching
 * Prevents inflated tech counts in analytics & invoices
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'historical_data.json');

// ── Canonical Name Map ──────────────────────────────────────────────
// Maps all known variants → canonical full name
const CANONICAL_MAP = {
  // Chris Ambler variants
  'chris':         'Chris Ambler',
  'chris amber':   'Chris Ambler',
  'chris ambler':  'Chris Ambler',
  'khris':         'Chris Ambler',

  // Derrick Martin variants
  'derrick':        'Derrick Martin',
  'derrick martin': 'Derrick Martin',
  'derick martin':  'Derrick Martin',

  // Kevin Jackson variants
  'kevin jackson':  'Kevin Jackson',

  // Marcus Martin variants
  'marcus':         'Marcus Martin',
  'marcus martin':  'Marcus Martin',

  // Remington Taylor variants
  'remington':       'Remington Taylor',
  'remington taylor':'Remington Taylor',

  // Levi — two distinct last names, keep separate unless confirmed same person
  'levi johnson':    'Levi Johnson',
  'levi taylor':     'Levi Taylor',

  // Others — normalize casing
  'andrew':          'Andrew',
  'angel':           'Angel',
  'aziz':            'Aziz',
  'patrick':         'Patrick',
  'tanya':           'Tanya',
};

// ── Fuzzy fallback for unknown names ────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function fuzzyMatch(name, canonicals) {
  const lower = name.toLowerCase().trim();
  let bestMatch = null, bestDist = Infinity;
  for (const key of Object.keys(canonicals)) {
    const dist = levenshtein(lower, key);
    // Allow up to 2 edits for short names, 3 for longer ones
    const threshold = key.length <= 6 ? 2 : 3;
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      bestMatch = canonicals[key];
    }
  }
  return bestMatch;
}

function normalizeTechName(rawName) {
  if (!rawName) return rawName;
  const trimmed = rawName.toString().trim();
  const lower = trimmed.toLowerCase();

  // Direct lookup
  if (CANONICAL_MAP[lower]) return CANONICAL_MAP[lower];

  // Fuzzy fallback
  const fuzzy = fuzzyMatch(trimmed, CANONICAL_MAP);
  if (fuzzy) return fuzzy;

  // No match — return title-cased original
  return trimmed.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main ────────────────────────────────────────────────────────────
function run() {
  console.log('📋 Tech Name Normalization — CareGen Alliance\n');

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const changes = {};
  let totalChanged = 0;

  // Normalize records
  data.records.forEach(record => {
    const original = (record.tech || '').toString().trim();
    if (!original) return;

    const normalized = normalizeTechName(original);
    if (normalized !== original) {
      const key = `"${original}" → "${normalized}"`;
      changes[key] = (changes[key] || 0) + 1;
      record.tech = normalized;
      totalChanged++;
    }
  });

  // Print change summary
  console.log('─── Changes ───────────────────────────────────────');
  const sortedChanges = Object.entries(changes).sort((a, b) => b[1] - a[1]);
  sortedChanges.forEach(([change, count]) => {
    console.log(`  ${count.toString().padStart(5)}x  ${change}`);
  });

  console.log(`\n  Total records updated: ${totalChanged} / ${data.records.length}`);

  // Post-normalization tech count
  const postNames = {};
  data.records.forEach(r => {
    const n = (r.tech || '').trim();
    if (n) postNames[n] = (postNames[n] || 0) + 1;
  });
  console.log('\n─── Normalized Tech Roster ─────────────────────────');
  Object.entries(postNames)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      console.log(`  ${count.toString().padStart(5)} work orders  |  ${name}`);
    });
  console.log(`\n  Unique techs: ${Object.keys(postNames).length} (was 22)\n`);

  // Save
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('✅ Saved normalized data to historical_data.json');
}

run();

/**
 * Data QC & Cleanup — CareGen Alliance
 * Removes phantom subtotal rows and cross-invoice duplicates
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'historical_data.json');

function run() {
  console.log('🔍 CareGen Alliance — Data QC & Cleanup\n');

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const originalCount = data.records.length;

  // ── STEP 1: Remove phantom subtotal rows ──────────────────────
  // These have no serviceOrderId and totals > $500 (they're sheet subtotals)
  const phantomThreshold = 500;
  const phantoms = data.records.filter(r => 
    !r.serviceOrderId && parseFloat(r.total) > phantomThreshold
  );
  
  console.log('─── Phantom Subtotal Rows (removing) ─────────────');
  console.log(`  Found: ${phantoms.length} rows with no service order and total > $${phantomThreshold}`);
  
  let phantomRevenue = 0;
  phantoms.forEach(r => {
    phantomRevenue += parseFloat(r.total) || 0;
  });
  console.log(`  Inflated revenue: $${phantomRevenue.toLocaleString()}\n`);

  // Remove phantoms
  data.records = data.records.filter(r => 
    r.serviceOrderId || parseFloat(r.total) <= phantomThreshold
  );

  // ── STEP 2: Remove cross-invoice duplicate records ────────────
  // Same serviceOrderId + same tech + same total appearing in multiple invoices
  const seen = new Map();
  const dupes = [];
  
  data.records = data.records.filter(r => {
    if (!r.serviceOrderId) return true; // keep records without SOIDs (small ones)
    
    const key = `${r.serviceOrderId}|${r.tech}|${r.total}`;
    if (seen.has(key)) {
      dupes.push(r);
      return false; // remove duplicate
    }
    seen.set(key, r.invoiceNumber);
    return true;
  });

  console.log('─── Cross-Invoice Duplicates (removing) ───────────');
  console.log(`  Found: ${dupes.length} duplicate records\n`);

  // ── STEP 3: Recalculate invoice grandTotals from clean records ─
  console.log('─── Recalculating Invoice Totals ──────────────────');
  let fixedCount = 0;
  
  data.invoices.forEach(inv => {
    const invRecords = data.records.filter(r => r.invoiceNumber === inv.invoiceNumber);
    if (invRecords.length === 0) return;
    
    const calculatedTotal = invRecords.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    
    if (calculatedTotal !== inv.grandTotal) {
      console.log(`  Inv #${inv.invoiceNumber}: $${inv.grandTotal.toLocaleString()} → $${calculatedTotal.toLocaleString()} (${invRecords.length} orders)`);
      inv.grandTotal = calculatedTotal;
      inv.workOrderCount = invRecords.length;
      fixedCount++;
    }
  });
  console.log(`  Fixed: ${fixedCount} invoice totals\n`);

  // ── STEP 4: Final revenue audit ───────────────────────────────
  console.log('─── Clean Tech Revenue ────────────────────────────');
  const techRev = {};
  data.records.forEach(r => {
    const t = r.tech || 'Unknown';
    techRev[t] = (techRev[t] || 0) + (parseFloat(r.total) || 0);
  });
  
  Object.entries(techRev)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tech, rev]) => {
      const records = data.records.filter(r => r.tech === tech).length;
      console.log(`  $${rev.toLocaleString().padStart(10)} | ${records.toString().padStart(5)} orders | ${tech}`);
    });

  const totalRev = Object.values(techRev).reduce((s, v) => s + v, 0);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  $${totalRev.toLocaleString().padStart(10)} | ${data.records.length.toString().padStart(5)} orders | TOTAL`);

  // Summary
  console.log('\n─── Summary ───────────────────────────────────────');
  console.log(`  Records: ${originalCount} → ${data.records.length} (removed ${originalCount - data.records.length})`);
  console.log(`  Phantom subtotals removed: ${phantoms.length}`);
  console.log(`  Duplicates removed: ${dupes.length}`);
  console.log(`  Invoice totals fixed: ${fixedCount}`);

  // Save
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('\n✅ Saved clean data to historical_data.json');
}

run();

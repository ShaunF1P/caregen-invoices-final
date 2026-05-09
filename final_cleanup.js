/**
 * CareGen Alliance - Final Data Cleanup
 * 
 * 1. Remove non-CareGen invoice entries (>241, $0 templates from 1001-2045 series)
 * 2. Remove the "0" invoice entry (Rates sheet)
 * 3. De-duplicate work order records
 * 4. Recalculate gaps within the real range (1-241)
 * 5. Validate data integrity
 */

const fs = require('fs');
const path = require('path');

const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  CareGen Alliance - Final Data Cleanup & QC');
console.log('═══════════════════════════════════════════════════════════════\n');

const data = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));
console.log(`📂 Loaded: ${data.invoices.length} invoices, ${(data.records || []).length} records\n`);

// ──────────────────────────────────────────────
// STEP 1: Remove non-CareGen invoice entries
// ──────────────────────────────────────────────
console.log('── STEP 1: Removing non-CareGen entries ──');

const beforeCount = data.invoices.length;

// Keep only valid CareGen invoices:
// - Invoice numbers 1-241 (the known range)
// - Must have invoiceNumber > 0
// - Remove entries that are clearly template/blank ($0 from Current Invoices series)
const cleanInvoices = data.invoices.filter(inv => {
  // Remove null/undefined invoice numbers
  if (inv.invoiceNumber == null || isNaN(inv.invoiceNumber)) {
    console.log(`   🗑  Removed: null invoice number from ${inv.source}`);
    return false;
  }
  
  // Remove invoice #0 (Rates sheet)
  if (inv.invoiceNumber === 0) {
    console.log(`   🗑  Removed: Inv#0 (${inv.sheetName}) from ${inv.source}`);
    return false;
  }
  
  // Remove anything > 241 (non-CareGen weekly invoice series)
  if (inv.invoiceNumber > 241) {
    return false; // Silently remove - these are other client invoices
  }
  
  return true;
});

const removedJunk = beforeCount - cleanInvoices.length;
console.log(`   Removed ${removedJunk} non-CareGen entries (templates, other clients, etc.)\n`);

// ──────────────────────────────────────────────
// STEP 2: De-duplicate by invoice number (keep best data)
// ──────────────────────────────────────────────
console.log('── STEP 2: De-duplicating by invoice number ──');

const invMap = new Map();
let dupesResolved = 0;

for (const inv of cleanInvoices) {
  const num = inv.invoiceNumber;
  if (invMap.has(num)) {
    const existing = invMap.get(num);
    dupesResolved++;
    // Keep the one with more data (higher total or more work orders)
    const existScore = (existing.grandTotal || 0) + (existing.workOrderCount || 0) * 100 + 
                       (existing.invoiceDate ? 50 : 0) + (existing.weekEndingDate ? 50 : 0) + (existing.billTo ? 25 : 0);
    const newScore = (inv.grandTotal || 0) + (inv.workOrderCount || 0) * 100 +
                     (inv.invoiceDate ? 50 : 0) + (inv.weekEndingDate ? 50 : 0) + (inv.billTo ? 25 : 0);
    
    if (newScore > existScore) {
      // Merge useful data from existing into new
      if (existing.weekEndingDate && !inv.weekEndingDate) inv.weekEndingDate = existing.weekEndingDate;
      if (existing.invoiceDate && !inv.invoiceDate) inv.invoiceDate = existing.invoiceDate;
      if (existing.invoiceDateStr && !inv.invoiceDateStr) inv.invoiceDateStr = existing.invoiceDateStr;
      if (existing.billTo && !inv.billTo) inv.billTo = existing.billTo;
      invMap.set(num, inv);
      console.log(`   🔄 Inv#${num}: replaced (${existing.source} -> ${inv.source})`);
    } else {
      // Merge useful data from new into existing
      if (inv.weekEndingDate && !existing.weekEndingDate) existing.weekEndingDate = inv.weekEndingDate;
      if (inv.invoiceDate && !existing.invoiceDate) existing.invoiceDate = inv.invoiceDate;
      if (inv.invoiceDateStr && !existing.invoiceDateStr) existing.invoiceDateStr = inv.invoiceDateStr;
      if (inv.billTo && !existing.billTo) existing.billTo = inv.billTo;
      if (inv.workOrderCount > (existing.workOrderCount || 0)) existing.workOrderCount = inv.workOrderCount;
    }
  } else {
    invMap.set(num, inv);
  }
}

console.log(`   Resolved ${dupesResolved} duplicate entries\n`);

// ──────────────────────────────────────────────
// STEP 3: Clean work order records
// ──────────────────────────────────────────────
console.log('── STEP 3: Cleaning work order records ──');

const records = data.records || [];
const validInvNums = new Set([...invMap.keys()]);

// Remove records for non-CareGen invoices
const filteredRecords = records.filter(r => validInvNums.has(r.invoiceNumber));
const removedRecords = records.length - filteredRecords.length;

// De-duplicate records
const seen = new Set();
const cleanRecords = [];
let dupsRemoved = 0;

for (const r of filteredRecords) {
  const key = [r.invoiceNumber, r.serviceOrderId, r.tech, r.total, r.date].join('|');
  if (seen.has(key)) {
    dupsRemoved++;
    continue;
  }
  seen.add(key);
  cleanRecords.push(r);
}

console.log(`   Removed ${removedRecords} records for non-CareGen invoices`);
console.log(`   Removed ${dupsRemoved} duplicate work order records`);
console.log(`   Clean records: ${cleanRecords.length}\n`);

// ──────────────────────────────────────────────
// STEP 4: Sort and calculate gaps
// ──────────────────────────────────────────────
console.log('── STEP 4: Calculating gaps ──');

const finalInvoices = [...invMap.values()].sort((a, b) => a.invoiceNumber - b.invoiceNumber);
const allNums = new Set(finalInvoices.map(i => i.invoiceNumber));
const gaps = [];
for (let i = 1; i <= 241; i++) {
  if (!allNums.has(i)) gaps.push(i);
}

console.log(`   Invoice range: 1-241`);
console.log(`   Present: ${allNums.size}`);
console.log(`   Missing: ${gaps.length}`);
if (gaps.length > 0) {
  console.log(`   Missing numbers: ${gaps.join(', ')}`);
}

// ──────────────────────────────────────────────
// STEP 5: Validate data quality
// ──────────────────────────────────────────────
console.log('\n── STEP 5: Final Validation ──');

let warnings = 0;

// Check for $0 invoices
const zeroTotals = finalInvoices.filter(i => !i.grandTotal || i.grandTotal === 0);
if (zeroTotals.length > 0) {
  console.log(`   ⚠ ${zeroTotals.length} invoices with $0 total:`);
  zeroTotals.forEach(i => {
    console.log(`     Inv#${i.invoiceNumber} | Sheet: ${i.sheetName} | Source: ${i.source}`);
    warnings++;
  });
}

// Check for missing dates
const noDates = finalInvoices.filter(i => !i.invoiceDate && !i.invoiceDateStr);
if (noDates.length > 0) {
  console.log(`   ⚠ ${noDates.length} invoices without dates:`);
  noDates.slice(0, 10).forEach(i => console.log(`     Inv#${i.invoiceNumber} | $${i.grandTotal} | ${i.source}`));
  if (noDates.length > 10) console.log(`     ... and ${noDates.length - 10} more`);
  warnings += noDates.length;
}

// Check for exact duplicate totals (possible double counting)
console.log('\n   Checking for potential double-counted invoices...');
const totalGroups = {};
finalInvoices.filter(i => i.grandTotal > 5000).forEach(i => {
  const key = i.grandTotal;
  if (!totalGroups[key]) totalGroups[key] = [];
  totalGroups[key].push(i);
});
const suspiciousPairs = Object.entries(totalGroups).filter(([k, v]) => v.length > 1);
if (suspiciousPairs.length > 0) {
  console.log(`   ℹ ${suspiciousPairs.length} pairs with matching totals (may be coincidental):`);
  suspiciousPairs.forEach(([total, invs]) => {
    const nums = invs.map(i => `#${i.invoiceNumber}`).join(', ');
    console.log(`     $${parseInt(total).toLocaleString()}: ${nums}`);
  });
} else {
  console.log('   ✓ No suspicious duplicate totals');
}

// ──────────────────────────────────────────────
// STEP 6: Save clean data
// ──────────────────────────────────────────────
const finalData = {
  extractedAt: new Date().toISOString(),
  totalInvoiceRange: '1-241',
  invoices: finalInvoices,
  records: cleanRecords,
  gaps,
};

fs.writeFileSync(HISTORICAL_DATA_PATH, JSON.stringify(finalData, null, 2));

// ──────────────────────────────────────────────
// FINAL REPORT
// ──────────────────────────────────────────────
const totalRev = finalInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
const withRev = finalInvoices.filter(i => i.grandTotal > 0);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  FINAL CLEAN DATA REPORT');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  📊 Total CareGen Invoices:   ${finalInvoices.length} / 241`);
console.log(`  ✅ Coverage:                 ${((finalInvoices.length / 241) * 100).toFixed(1)}%`);
console.log(`  ⚠  Missing Invoices:         ${gaps.length}`);
console.log(`  📋 Work Order Records:       ${cleanRecords.length}`);
console.log(`  💰 Total Revenue:            $${totalRev.toLocaleString()}`);
console.log(`  📈 Average per Invoice:      $${Math.round(totalRev / withRev.length).toLocaleString()}`);
console.log(`  📉 Min Invoice:              $${Math.min(...withRev.map(i => i.grandTotal)).toLocaleString()}`);
console.log(`  📈 Max Invoice:              $${Math.max(...withRev.map(i => i.grandTotal)).toLocaleString()}`);
console.log(`  ⚠  Warnings:                ${warnings}`);

if (gaps.length > 0) {
  console.log(`\n  ── REMAINING GAPS ──`);
  console.log(`  ${gaps.join(', ')}`);
  console.log(`\n  These invoice numbers do not exist in any available source file.`);
  console.log(`  Possible explanations:`);
  console.log(`    - Skipped during original numbering`);
  console.log(`    - Filed under a different naming convention`);
  console.log(`    - Stored in a different email account (Travis Wilson era)`);
}

console.log('═══════════════════════════════════════════════════════════════\n');

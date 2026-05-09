/**
 * CareGen Alliance - Comprehensive Data QC Audit
 * Checks for duplicates, data integrity issues, and suspicious entries
 */

const fs = require('fs');
const path = require('path');

const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');
const d = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));

console.log('========================================');
console.log('  COMPREHENSIVE DATA QC AUDIT');
console.log('========================================\n');

let issues = [];

// 1. Check for duplicate invoice numbers
const invNums = d.invoices.map(i => i.invoiceNumber);
const counts = {};
invNums.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
const dupes = Object.entries(counts).filter(([k, v]) => v > 1);
console.log('1. DUPLICATE INVOICE NUMBERS:', dupes.length > 0 ? 'FOUND ⚠' : 'CLEAN ✓');
dupes.forEach(([num, count]) => {
  console.log(`   Inv #${num} appears ${count} times:`);
  d.invoices.forEach((inv, idx) => {
    if (String(inv.invoiceNumber) === num) {
      console.log(`     [${idx}] Src: ${inv.source} | Total: ${inv.grandTotal} | WOs: ${inv.workOrderCount || 0} | Sheet: ${inv.sheetName}`);
      issues.push({ type: 'DUPLICATE_INVOICE', invoiceNumber: parseInt(num), idx, source: inv.source });
    }
  });
});

// 2. Check for duplicate sources (same source+sheet)
console.log('\n2. DUPLICATE SOURCE+SHEET COMBOS:');
const srcSheet = {};
d.invoices.forEach((inv, idx) => {
  const key = (inv.source || '') + '|' + (inv.sheetName || '');
  if (!srcSheet[key]) srcSheet[key] = [];
  srcSheet[key].push({ idx, invNum: inv.invoiceNumber, total: inv.grandTotal });
});
let dupSrcCount = 0;
Object.entries(srcSheet).filter(([k, v]) => v.length > 1).forEach(([key, items]) => {
  dupSrcCount++;
  const shortKey = key.length > 70 ? key.substring(0, 70) + '...' : key;
  console.log(`   ${shortKey}`);
  items.forEach(i => console.log(`     Inv#${i.invNum} = \$${(i.total || 0).toLocaleString()}`));
  issues.push({ type: 'DUPLICATE_SOURCE_SHEET', key, items });
});
if (dupSrcCount === 0) console.log('   CLEAN ✓ - no duplicate source+sheet combos');

// 3. Check for invoices with suspicious totals
console.log('\n3. SUSPICIOUS TOTALS:');
const zeroTotal = d.invoices.filter(i => !i.grandTotal || i.grandTotal === 0);
const highTotal = d.invoices.filter(i => i.grandTotal > 100000);
const negativeTotal = d.invoices.filter(i => i.grandTotal < 0);

console.log(`   Zero/null totals: ${zeroTotal.length}`);
zeroTotal.forEach(i => {
  console.log(`     Inv#${i.invoiceNumber} Src: ${i.source} Sheet: ${i.sheetName}`);
  issues.push({ type: 'ZERO_TOTAL', invoiceNumber: i.invoiceNumber, source: i.source });
});

console.log(`   Over 100k: ${highTotal.length}`);
highTotal.forEach(i => {
  console.log(`     Inv#${i.invoiceNumber} = \$${i.grandTotal.toLocaleString()} Src: ${i.source}`);
});

console.log(`   Negative totals: ${negativeTotal.length}`);

// 4. Check Invoice 241 specifically (user reported it looks doubled)
console.log('\n4. INVOICE 241 DEEP INSPECTION:');
const inv241 = d.invoices.filter(i => i.invoiceNumber === 241);
console.log(`   Found ${inv241.length} entries for Invoice 241:`);
inv241.forEach((inv, j) => {
  console.log(`   Entry ${j + 1}:`);
  console.log(`     Source: ${inv.source}`);
  console.log(`     Sheet: ${inv.sheetName}`);
  console.log(`     Total: \$${(inv.grandTotal || 0).toLocaleString()}`);
  console.log(`     Work Orders: ${inv.workOrderCount || 0}`);
  console.log(`     Date: ${inv.invoiceDateStr || inv.invoiceDate || 'N/A'}`);
  console.log(`     Week Ending: ${inv.weekEndingDate || inv.weekEnding || 'N/A'}`);
  console.log(`     Bill To: ${inv.billTo || 'N/A'}`);
  console.log(`     Type: ${inv.type || 'N/A'}`);
});

// Also check invoices around 241 for context
console.log('\n   Invoices around 241:');
d.invoices.filter(i => i.invoiceNumber >= 238 && i.invoiceNumber <= 241)
  .sort((a, b) => a.invoiceNumber - b.invoiceNumber)
  .forEach(i => {
    console.log(`     Inv#${i.invoiceNumber} | \$${(i.grandTotal || 0).toLocaleString()} | WOs: ${i.workOrderCount || 0} | ${i.source}`);
  });

// 5. Check for same totals that might indicate double-counted data
console.log('\n5. POTENTIAL DOUBLE-COUNTED (same total, different invoice #):');
const sorted = [...d.invoices].filter(i => i.grandTotal > 3000).sort((a, b) => (a.invoiceNumber || 0) - (b.invoiceNumber || 0));
let doubleCount = 0;
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length; j++) {
    if (sorted[i].grandTotal === sorted[j].grandTotal && sorted[i].grandTotal > 5000) {
      doubleCount++;
      if (doubleCount <= 20) {
        console.log(`   Inv#${sorted[i].invoiceNumber} and Inv#${sorted[j].invoiceNumber} both = \$${sorted[i].grandTotal.toLocaleString()}`);
        console.log(`     Src1: ${sorted[i].source} | Src2: ${sorted[j].source}`);
      }
    }
  }
}
if (doubleCount === 0) console.log('   CLEAN ✓');
else if (doubleCount > 20) console.log(`   ... and ${doubleCount - 20} more`);

// 6. Check for invoice number vs source mismatch
console.log('\n6. INVOICE NUMBER vs FILENAME MISMATCH:');
let mismatches = 0;
d.invoices.forEach(inv => {
  if (!inv.source || !inv.invoiceNumber) return;
  // Try to extract number from source filename
  const srcMatch = inv.source.match(/(?:Dataset|DataSet|Invoice|Inv)\s*#?\s*(\d+)/i);
  if (srcMatch) {
    const srcNum = parseInt(srcMatch[1]);
    if (srcNum !== inv.invoiceNumber && srcNum > 0 && inv.invoiceNumber > 0) {
      // Some files like "Consolidated Inv 42" actually contain Invoice 1, that's the file naming
      if (Math.abs(srcNum - inv.invoiceNumber) > 5) {
        mismatches++;
        if (mismatches <= 10) {
          console.log(`   Inv#${inv.invoiceNumber} from file suggesting #${srcNum}: ${inv.source}`);
          issues.push({ type: 'NUMBER_MISMATCH', invoiceNumber: inv.invoiceNumber, fileNumber: srcNum, source: inv.source });
        }
      }
    }
  }
});
if (mismatches === 0) console.log('   CLEAN ✓');
else if (mismatches > 10) console.log(`   ... and ${mismatches - 10} more`);

// 7. Check work order records for duplicates
if (d.records && d.records.length > 0) {
  console.log('\n7. WORK ORDER RECORD QC:');
  const woKeys = {};
  d.records.forEach((r, idx) => {
    const key = r.invoiceNumber + '|' + (r.serviceOrderId || '') + '|' + r.total;
    if (!woKeys[key]) woKeys[key] = [];
    woKeys[key].push(idx);
  });
  const woDupes = Object.entries(woKeys).filter(([k, v]) => v.length > 1);
  console.log(`   Total records: ${d.records.length}`);
  console.log(`   Unique record keys: ${Object.keys(woKeys).length}`);
  console.log(`   Duplicate record sets: ${woDupes.length}`);
  const totalDupeRecords = woDupes.reduce((s, [k, v]) => s + (v.length - 1), 0);
  console.log(`   Total duplicate records to remove: ${totalDupeRecords}`);
  
  if (woDupes.length > 0 && woDupes.length <= 20) {
    console.log('   Sample duplicates:');
    woDupes.slice(0, 10).forEach(([key, idxs]) => {
      const parts = key.split('|');
      console.log(`     Inv#${parts[0]} SO:${parts[1] || 'N/A'} Total:${parts[2]} (${idxs.length}x)`);
    });
  }
  issues.push(...woDupes.map(([key, idxs]) => ({ type: 'DUPLICATE_RECORD', key, count: idxs.length, indices: idxs })));
} else {
  console.log('\n7. WORK ORDER RECORDS: None present');
}

// 8. Revenue summary
console.log('\n8. REVENUE SUMMARY:');
const totalRev = d.invoices.reduce((s, i) => (s + (i.grandTotal || 0)), 0);
const avgRev = totalRev / d.invoices.filter(i => i.grandTotal > 0).length;
console.log(`   Total invoices: ${d.invoices.length}`);
console.log(`   With revenue data: ${d.invoices.filter(i => i.grandTotal > 0).length}`);
console.log(`   Total revenue: \$${totalRev.toLocaleString()}`);
console.log(`   Average per invoice: \$${Math.round(avgRev).toLocaleString()}`);
console.log(`   Min: \$${Math.min(...d.invoices.filter(i=>i.grandTotal>0).map(i=>i.grandTotal)).toLocaleString()}`);
console.log(`   Max: \$${Math.max(...d.invoices.map(i=>i.grandTotal||0)).toLocaleString()}`);

// 9. Outlier detection (invoices > 2 standard deviations from mean)
console.log('\n9. OUTLIER DETECTION (>2 std dev from mean):');
const totals = d.invoices.filter(i => i.grandTotal > 0).map(i => i.grandTotal);
const mean = totals.reduce((s, t) => s + t, 0) / totals.length;
const stdDev = Math.sqrt(totals.reduce((s, t) => s + Math.pow(t - mean, 2), 0) / totals.length);
const threshold = mean + 2 * stdDev;
console.log(`   Mean: \$${Math.round(mean).toLocaleString()}`);
console.log(`   Std Dev: \$${Math.round(stdDev).toLocaleString()}`);
console.log(`   Outlier threshold: > \$${Math.round(threshold).toLocaleString()}`);
const outliers = d.invoices.filter(i => i.grandTotal > threshold);
outliers.sort((a, b) => b.grandTotal - a.grandTotal);
outliers.forEach(i => {
  console.log(`   ⚠ Inv#${i.invoiceNumber} = \$${i.grandTotal.toLocaleString()} (${(i.grandTotal / mean).toFixed(1)}x avg) - ${i.source}`);
});

// 10. Date continuity check
console.log('\n10. DATE GAPS (missing weeks):');
const withDates = d.invoices
  .filter(i => i.weekEndingDate || i.weekEnding)
  .map(i => ({
    num: i.invoiceNumber,
    date: i.weekEndingDate || i.weekEnding,
  }))
  .sort((a, b) => a.num - b.num);

let dateGaps = 0;
for (let i = 1; i < withDates.length; i++) {
  const prev = new Date(withDates[i - 1].date);
  const curr = new Date(withDates[i].date);
  if (isNaN(prev) || isNaN(curr)) continue;
  const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
  if (diffDays > 14) { // More than 2 weeks between sequential invoices
    dateGaps++;
    if (dateGaps <= 10) {
      console.log(`   Gap between Inv#${withDates[i-1].num} (${withDates[i-1].date}) and Inv#${withDates[i].num} (${withDates[i].date}) = ${Math.round(diffDays)} days`);
    }
  }
}
if (dateGaps === 0) console.log('   CLEAN ✓');

// FINAL SUMMARY
console.log('\n========================================');
console.log('  QC SUMMARY');
console.log('========================================');
const issueTypes = {};
issues.forEach(i => { issueTypes[i.type] = (issueTypes[i.type] || 0) + 1; });
console.log(`  Total issues found: ${issues.length}`);
Object.entries(issueTypes).forEach(([type, count]) => {
  console.log(`    ${type}: ${count}`);
});
console.log('========================================\n');

// Save issues for the cleanup script
fs.writeFileSync(path.join(__dirname, 'data', 'qc_issues.json'), JSON.stringify(issues, null, 2));
console.log('Issues saved to data/qc_issues.json');

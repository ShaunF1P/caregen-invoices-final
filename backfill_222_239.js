/**
 * Backfill invoices #222-239 into historical_data.json
 * Data extracted from CareGen Alliance Gmail Sent folder attachments
 */

const fs = require('fs');
const path = require('path');

const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');

// Data extracted from Gmail attachment previews
const missingInvoices = [
  { invoiceNumber: 222, invoiceDateStr: '2025-12-21', weekEndingDate: '2025-12-22', workOrderCount: 47, grandTotal: 6500 },
  { invoiceNumber: 223, invoiceDateStr: '2025-12-28', weekEndingDate: '2025-12-27', workOrderCount: 21, grandTotal: 3265 },
  { invoiceNumber: 224, invoiceDateStr: '2026-01-04', weekEndingDate: '2026-01-03', workOrderCount: 21, grandTotal: 2920 },
  { invoiceNumber: 225, invoiceDateStr: '2026-01-11', weekEndingDate: '2026-01-10', workOrderCount: 35, grandTotal: 5300 },
  { invoiceNumber: 226, invoiceDateStr: '2026-01-18', weekEndingDate: '2026-01-17', workOrderCount: 34, grandTotal: 4935 },
  { invoiceNumber: 227, invoiceDateStr: '2026-01-25', weekEndingDate: '2026-01-24', workOrderCount: 39, grandTotal: 5755 },
  { invoiceNumber: 228, invoiceDateStr: '2026-01-31', weekEndingDate: '2026-02-01', workOrderCount: 24, grandTotal: 3480 },
  { invoiceNumber: 229, invoiceDateStr: '2026-02-08', weekEndingDate: '2026-02-07', workOrderCount: 28, grandTotal: 5080 },
  { invoiceNumber: 230, invoiceDateStr: '2026-02-15', weekEndingDate: '2026-02-14', workOrderCount: 29, grandTotal: 3745 },
  { invoiceNumber: 231, invoiceDateStr: '2026-02-22', weekEndingDate: '2026-02-21', workOrderCount: 24, grandTotal: 3210 },
  { invoiceNumber: 232, invoiceDateStr: '2026-03-01', weekEndingDate: '2026-02-28', workOrderCount: 31, grandTotal: 4470 },
  { invoiceNumber: 233, invoiceDateStr: '2026-03-08', weekEndingDate: '2026-03-07', workOrderCount: 27, grandTotal: 4355 },
  { invoiceNumber: 234, invoiceDateStr: '2026-03-15', weekEndingDate: '2026-03-14', workOrderCount: 41, grandTotal: 6750 },
  { invoiceNumber: 235, invoiceDateStr: '2026-03-22', weekEndingDate: '2026-03-21', workOrderCount: 28, grandTotal: 5315 },
  { invoiceNumber: 236, invoiceDateStr: '2026-03-29', weekEndingDate: '2026-03-28', workOrderCount: 41, grandTotal: 5215 },
  { invoiceNumber: 237, invoiceDateStr: '2026-04-05', weekEndingDate: '2026-04-04', workOrderCount: 52, grandTotal: 8640 },
  { invoiceNumber: 238, invoiceDateStr: '2026-04-12', weekEndingDate: '2026-04-11', workOrderCount: 50, grandTotal: 6450 },
  { invoiceNumber: 239, invoiceDateStr: '2026-04-19', weekEndingDate: '2026-04-18', workOrderCount: 40, grandTotal: 5735 },
];

// Load existing data
const historicalData = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));
const existingNums = new Set(historicalData.invoices.map(i => i.invoiceNumber));

let added = 0;
for (const inv of missingInvoices) {
  if (existingNums.has(inv.invoiceNumber)) {
    console.log(`  ⚠ Inv #${inv.invoiceNumber} already exists - skipping`);
    continue;
  }

  historicalData.invoices.push({
    sheetName: `Data Set ${inv.invoiceNumber}`,
    source: 'Gmail Sent - CareGen Alliance',
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: null,
    weekEnding: null,
    grandTotal: inv.grandTotal,
    weekEndingDate: inv.weekEndingDate,
    invoiceDateStr: inv.invoiceDateStr,
    workOrderCount: inv.workOrderCount,
  });

  added++;
  console.log(`  ✓ Added Inv #${inv.invoiceNumber}: ${inv.weekEndingDate}, ${inv.workOrderCount} WOs, $${inv.grandTotal.toLocaleString()}`);
}

// Re-sort by invoice number
historicalData.invoices.sort((a, b) => a.invoiceNumber - b.invoiceNumber);

// Recalculate gaps
const allNums = historicalData.invoices.map(i => i.invoiceNumber).filter(n => n > 0);
const minNum = Math.min(...allNums);
const maxNum = Math.max(...allNums);
const gaps = [];
for (let i = minNum; i <= maxNum; i++) {
  if (!allNums.includes(i)) gaps.push(i);
}
historicalData.gaps = gaps;
historicalData.extractedAt = new Date().toISOString();

// Save
fs.writeFileSync(HISTORICAL_DATA_PATH, JSON.stringify(historicalData, null, 2));

// Summary
const totalRevenue = historicalData.invoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
console.log('\n═══════════════════════════════════════════════════════');
console.log('  BACKFILL COMPLETE');
console.log('═══════════════════════════════════════════════════════');
console.log(`  ➕ Added:          ${added} invoices`);
console.log(`  📊 Total Invoices: ${historicalData.invoices.length}`);
console.log(`  💰 Total Revenue:  $${totalRevenue.toLocaleString()}`);
console.log(`  ⚠  Remaining Gaps: ${gaps.length}`);

// Show invoice 222-241 range to verify continuity
const range = historicalData.invoices
  .filter(i => i.invoiceNumber >= 222 && i.invoiceNumber <= 241)
  .map(i => `  #${i.invoiceNumber}: ${i.weekEndingDate} — $${(i.grandTotal || 0).toLocaleString()} (${i.workOrderCount} WOs)`)
  .join('\n');
console.log('\n📋 Invoices 222-241 (previously missing):');
console.log(range);
console.log('═══════════════════════════════════════════════════════');

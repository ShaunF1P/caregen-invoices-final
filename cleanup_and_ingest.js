/**
 * CareGen Alliance - Data Cleanup & Gap Ingestion
 * 
 * Phase 1: De-duplicate work order records
 * Phase 2: Ingest missing invoices from Master Consolidated & Current Invoices files
 * Phase 3: Final QC validation
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');
const DATA_DIR = path.join(__dirname, 'data');

// Excel serial date to JS Date
function excelDateToJSDate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  if (serial > 50000) return null; // Too large for a date serial
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000);
}

function formatDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

function formatDateStr(d) {
  if (!d || !(d instanceof Date) || isNaN(d)) return null;
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}

/**
 * Parse a single sheet from a workbook for invoice data
 */
function parseInvoiceSheet(ws, sheetName, source) {
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (!rawData || rawData.length < 3) return null;

  let invoiceDate = null, weekEnding = null, invoiceNumber = null;
  let type = null, grandTotal = null, billTo = null;

  // Extract invoice number from sheet name
  const sheetMatch = sheetName.match(/(?:Inv(?:oice)?)\s*#?\s*0*(\d+)/i);
  if (sheetMatch) {
    invoiceNumber = parseInt(sheetMatch[1]);
  }

  // Scan header rows (first 12 rows) for metadata
  for (let r = 0; r < Math.min(12, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').toUpperCase().trim();
      
      // Invoice Date
      if (val.includes('INVOICE DATE') || val === 'INVOICE DATE:') {
        const dateVal = row[c + 1] || row[c + 2];
        if (typeof dateVal === 'number') {
          invoiceDate = excelDateToJSDate(dateVal);
        } else if (dateVal) {
          const parsed = new Date(dateVal);
          if (!isNaN(parsed)) invoiceDate = parsed;
        }
      }
      
      // Week Ending
      if (val.includes('WEEK ENDING') || val === 'WEEK ENDING:') {
        const dateVal = row[c + 1] || row[c + 2];
        if (typeof dateVal === 'number') {
          weekEnding = excelDateToJSDate(dateVal);
        } else if (dateVal) {
          const parsed = new Date(dateVal);
          if (!isNaN(parsed)) weekEnding = parsed;
        }
      }
      
      // Invoice #
      if (val.includes('INVOICE #') || val === 'INVOICE #:' || val === 'INVOICE#' || val === 'INVOICE NO' || val === 'INVOICE NO:') {
        const numVal = row[c + 1] || row[c + 2];
        if (numVal) {
          const parsed = parseInt(String(numVal).replace(/\D/g, ''));
          if (!isNaN(parsed) && parsed > 0) invoiceNumber = parsed;
        }
      }
      
      // Type
      if (val === 'TYPE:' || val === 'TYPE') {
        type = String(row[c + 1] || row[c + 2] || 'Installation').trim();
      }
      
      // Grand Total
      if (val.includes('GRAND TOTAL')) {
        const totalVal = row[c + 1] || row[c + 2];
        if (totalVal) {
          const parsed = parseFloat(String(totalVal).replace(/[$,]/g, ''));
          if (!isNaN(parsed) && parsed > 0) grandTotal = parsed;
        }
      }
      
      // Bill To
      if (val.includes('BILL TO') || val === 'BILL TO:') {
        billTo = String(row[c + 1] || '').trim();
      }
    }
  }

  // Find work order header row
  let headerRow = -1;
  let headerMapping = {};
  for (let r = 0; r < Math.min(15, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toUpperCase()).join('|');
    if (rowStr.includes('WORK ORDER') || rowStr.includes('TECH NAME') || 
        rowStr.includes('SERVICES ORDER') || rowStr.includes('BASE WORK ORDER') ||
        rowStr.includes('SERVICE ORDER') || rowStr.includes('ROW LABELS')) {
      headerRow = r;
      for (let c = 0; c < row.length; c++) {
        const hdr = String(row[c] || '').toUpperCase().trim();
        if (hdr.includes('WORK ORDER DATE') || hdr === 'DATE') headerMapping.date = c;
        if (hdr.includes('TECH NAME') || hdr === 'TECH') headerMapping.tech = c;
        if (hdr.includes('SERVICES ORDER') || hdr.includes('SERVICE ORDER') || hdr === 'ROW LABELS') headerMapping.serviceOrder = c;
        if (hdr.includes('BASE WORK ORDER TYPE') || hdr.includes('BASE WORK ORDER')) {
          if (!hdr.includes('SUM')) headerMapping.workOrderType = c;
        }
        if (hdr.includes('SUM OF BASE') || (hdr.includes('BASE WORK ORDER') && hdr.includes('SUM'))) headerMapping.baseCharge = c;
        if (hdr.includes('ADDITIONAL') && !hdr.includes('SUM') && !hdr.includes('(1)') && !hdr.includes('(2)')) {
          if (headerMapping.additionalDesc1 === undefined) headerMapping.additionalDesc1 = c;
          else headerMapping.additionalDesc2 = c;
        }
        if (hdr.includes('ADDITIONAL (1)') || hdr.includes('SUM OF ADDITIONAL (1)')) headerMapping.additional1 = c;
        if (hdr.includes('ADDITIONAL (2)') || hdr.includes('SUM OF ADDITIONAL (2)')) headerMapping.additional2 = c;
        if (hdr === 'TOTAL' || hdr === 'SUM OF TOTAL' || hdr.includes('GRAND TOTAL')) headerMapping.total = c;
        if (hdr.includes('BASE WORK ORDER') && !hdr.includes('TYPE') && !hdr.includes('SUM')) {
          if (headerMapping.baseCharge === undefined) headerMapping.baseCharge = c;
        }
      }
      break;
    }
  }

  // Parse work orders
  const workOrders = [];
  let calculatedTotal = 0;
  if (headerRow >= 0) {
    let lastDate = null, lastTech = null;
    for (let r = headerRow + 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.length === 0) continue;

      const firstCell = String(row[0] || '').toUpperCase().trim();
      if (firstCell.includes('GRAND TOTAL')) break;
      if (firstCell === 'TOTAL' || (firstCell === '' && row.every(c => !c))) continue;

      let woDate = headerMapping.date !== undefined ? row[headerMapping.date] : null;
      let tech = headerMapping.tech !== undefined ? row[headerMapping.tech] : null;
      let serviceOrder = headerMapping.serviceOrder !== undefined ? row[headerMapping.serviceOrder] : null;
      let workOrderType = headerMapping.workOrderType !== undefined ? row[headerMapping.workOrderType] : null;
      let baseCharge = headerMapping.baseCharge !== undefined ? parseFloat(row[headerMapping.baseCharge] || 0) : 0;
      let additional1 = headerMapping.additional1 !== undefined ? parseFloat(row[headerMapping.additional1] || 0) : 0;
      let additional2 = headerMapping.additional2 !== undefined ? parseFloat(row[headerMapping.additional2] || 0) : 0;
      let total = headerMapping.total !== undefined ? parseFloat(row[headerMapping.total] || 0) : 0;

      if (woDate && typeof woDate === 'number') {
        const d = excelDateToJSDate(woDate);
        woDate = formatDate(d);
        lastDate = woDate;
      } else if (!woDate) {
        woDate = lastDate;
      }

      if (tech) { lastTech = String(tech).trim(); } else { tech = lastTech; }
      if (!serviceOrder && total === 0 && baseCharge === 0) continue;
      if (total === 0 && baseCharge > 0) total = baseCharge + additional1 + additional2;

      if (total > 0 || baseCharge > 0) {
        calculatedTotal += total || (baseCharge + additional1 + additional2);
        workOrders.push({
          date: woDate,
          tech: String(tech || '').trim(),
          serviceOrderId: String(serviceOrder || '').trim(),
          workOrderType: String(workOrderType || '').trim(),
          baseCharge, additional1, additional2,
          total: total || (baseCharge + additional1 + additional2),
        });
      }
    }
  }

  if (!grandTotal && calculatedTotal > 0) grandTotal = calculatedTotal;

  // Only return if we have meaningful data
  if (!invoiceNumber && !grandTotal) return null;

  return {
    sheetName,
    source,
    invoiceNumber,
    invoiceDate: formatDate(invoiceDate),
    weekEnding: weekEnding ? (typeof weekEnding === 'number' ? weekEnding : formatDate(weekEnding)) : null,
    grandTotal: grandTotal || calculatedTotal || 0,
    weekEndingDate: formatDate(weekEnding),
    invoiceDateStr: formatDateStr(invoiceDate),
    workOrderCount: workOrders.length,
    billTo: billTo || null,
    type: type || 'Installation',
    workOrders,
  };
}

// ====================================================================
//  MAIN
// ====================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CareGen Alliance - Data Cleanup & Gap Ingestion');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load historical data
  const historicalData = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));
  console.log(`📂 Loaded: ${historicalData.invoices.length} invoices, ${(historicalData.records || []).length} work order records\n`);

  // ──────────────────────────────────────────────
  // PHASE 1: De-duplicate work order records
  // ──────────────────────────────────────────────
  console.log('── PHASE 1: De-duplicating work order records ──');
  const records = historicalData.records || [];
  const seen = new Set();
  const cleanRecords = [];
  let dupsRemoved = 0;

  for (const r of records) {
    // Create a composite key for dedup
    const key = [r.invoiceNumber, r.serviceOrderId, r.tech, r.total, r.date].join('|');
    if (seen.has(key)) {
      dupsRemoved++;
      continue;
    }
    seen.add(key);
    cleanRecords.push(r);
  }
  console.log(`   Removed ${dupsRemoved} duplicate records`);
  console.log(`   Clean records: ${cleanRecords.length} (from ${records.length})\n`);

  // ──────────────────────────────────────────────
  // PHASE 2: Ingest missing invoices
  // ──────────────────────────────────────────────
  console.log('── PHASE 2: Ingesting missing invoices ──');
  
  const existingInvNums = new Set(historicalData.invoices.map(i => i.invoiceNumber));
  const invoiceMap = new Map(historicalData.invoices.map(i => [i.invoiceNumber, i]));
  const existingRecordInvNums = new Set(cleanRecords.map(r => r.invoiceNumber));

  // Missing invoice numbers
  const allExistingNums = [...existingInvNums].filter(n => n > 0);
  const maxNum = Math.max(...allExistingNums);
  const missingBefore = [];
  for (let i = 1; i <= maxNum; i++) {
    if (!existingInvNums.has(i)) missingBefore.push(i);
  }
  console.log(`   Currently missing: ${missingBefore.length} invoices`);
  console.log(`   Missing: ${missingBefore.join(', ')}\n`);

  // Files to process for gap closure
  const filesToProcess = [
    // Version (1)(2) - should have Inv 8 through 51
    'Master Consolidated updated (version 1).xlsb (1) (2).xlsx',
    // Version (1)(1) - may have overlapping data
    'Master Consolidated updated (version 1).xlsb (1) (1).xlsx',
    // Current Invoices - should have Invoice 052-076
    'Current Invoices (1).xlsx',
    'Current Invoices.xlsx',
  ];

  let newInvoices = 0;
  let updatedInvoices = 0;
  let newRecords = 0;

  for (const fileName of filesToProcess) {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠ File not found: ${fileName}`);
      continue;
    }

    console.log(`\n   📄 Processing: ${fileName}`);
    
    try {
      const wb = XLSX.readFile(filePath);
      console.log(`      Sheets: ${wb.SheetNames.length} - ${wb.SheetNames.slice(0, 10).join(', ')}${wb.SheetNames.length > 10 ? '...' : ''}`);

      for (const sheetName of wb.SheetNames) {
        // Skip non-invoice sheets
        const lowerSheet = sheetName.toLowerCase();
        if (lowerSheet === 'rates' || lowerSheet === 'rate' || lowerSheet === 'summary' || lowerSheet === 'template') continue;

        const ws = wb.Sheets[sheetName];
        const result = parseInvoiceSheet(ws, sheetName, fileName);
        
        if (!result || !result.invoiceNumber) {
          continue;
        }

        // Check if this is a missing invoice
        if (!invoiceMap.has(result.invoiceNumber)) {
          // New invoice - add it
          const entry = { ...result };
          delete entry.workOrders;
          invoiceMap.set(result.invoiceNumber, entry);
          newInvoices++;
          console.log(`      ✓ NEW Inv#${result.invoiceNumber} | $${(result.grandTotal || 0).toLocaleString()} | ${result.workOrderCount} WOs | ${result.invoiceDateStr || 'N/A'}`);

          // Add work order records
          if (result.workOrders && result.workOrders.length > 0) {
            for (const wo of result.workOrders) {
              const key = [result.invoiceNumber, wo.serviceOrderId, wo.tech, wo.total, wo.date].join('|');
              if (!seen.has(key)) {
                seen.add(key);
                cleanRecords.push({
                  invoiceNumber: result.invoiceNumber,
                  weekEnding: result.weekEndingDate,
                  ...wo,
                });
                newRecords++;
              }
            }
          }
        } else {
          // Invoice exists - enrich if needed
          const existing = invoiceMap.get(result.invoiceNumber);
          let enriched = false;
          
          if (result.weekEndingDate && !existing.weekEndingDate) {
            existing.weekEndingDate = result.weekEndingDate;
            enriched = true;
          }
          if (result.invoiceDate && !existing.invoiceDate) {
            existing.invoiceDate = result.invoiceDate;
            existing.invoiceDateStr = result.invoiceDateStr;
            enriched = true;
          }
          if (result.billTo && !existing.billTo) {
            existing.billTo = result.billTo;
            enriched = true;
          }
          if (result.grandTotal && (!existing.grandTotal || existing.grandTotal === 0)) {
            existing.grandTotal = result.grandTotal;
            enriched = true;
          }
          if (result.workOrderCount > (existing.workOrderCount || 0)) {
            existing.workOrderCount = result.workOrderCount;
            enriched = true;
          }
          
          if (enriched) {
            updatedInvoices++;
          }

          // Add work orders if we don't have them
          if (result.workOrders && result.workOrders.length > 0 && !existingRecordInvNums.has(result.invoiceNumber)) {
            for (const wo of result.workOrders) {
              const key = [result.invoiceNumber, wo.serviceOrderId, wo.tech, wo.total, wo.date].join('|');
              if (!seen.has(key)) {
                seen.add(key);
                cleanRecords.push({
                  invoiceNumber: result.invoiceNumber,
                  weekEnding: result.weekEndingDate,
                  ...wo,
                });
                newRecords++;
              }
            }
            existingRecordInvNums.add(result.invoiceNumber);
          }
        }
      }
    } catch (err) {
      console.error(`   ✗ Error processing ${fileName}: ${err.message}`);
    }
  }

  // ──────────────────────────────────────────────
  // PHASE 3: Build final clean dataset
  // ──────────────────────────────────────────────
  console.log('\n── PHASE 3: Building final clean dataset ──');

  // Remove any null-keyed invoices
  invoiceMap.delete(null);
  invoiceMap.delete(undefined);
  invoiceMap.delete(NaN);

  // Sort invoices by number
  const finalInvoices = [...invoiceMap.values()]
    .filter(i => i.invoiceNumber != null && !isNaN(i.invoiceNumber))
    .sort((a, b) => a.invoiceNumber - b.invoiceNumber);

  // Strip workOrders from invoice entries (they go in records)
  finalInvoices.forEach(inv => { delete inv.workOrders; });

  // Calculate final gaps
  const allNums = finalInvoices.map(i => i.invoiceNumber).filter(n => n > 0);
  const finalMax = Math.max(...allNums);
  const finalGaps = [];
  for (let i = 1; i <= finalMax; i++) {
    if (!allNums.includes(i)) finalGaps.push(i);
  }

  // Build output
  const finalData = {
    extractedAt: new Date().toISOString(),
    invoices: finalInvoices,
    records: cleanRecords,
    gaps: finalGaps,
  };

  // Write
  fs.writeFileSync(HISTORICAL_DATA_PATH, JSON.stringify(finalData, null, 2));

  // ──────────────────────────────────────────────
  // REPORT
  // ──────────────────────────────────────────────
  const totalRev = finalInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  CLEANUP & INGESTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  📊 Total Invoices:          ${finalInvoices.length}`);
  console.log(`  🆕 New Invoices Added:      ${newInvoices}`);
  console.log(`  🔄 Enriched Existing:       ${updatedInvoices}`);
  console.log(`  📋 Clean Work Order Records: ${cleanRecords.length}`);
  console.log(`  ➕ New Records Added:        ${newRecords}`);
  console.log(`  🗑  Duplicate Records Removed: ${dupsRemoved}`);
  console.log(`  ⚠  Remaining Gaps:          ${finalGaps.length}`);
  if (finalGaps.length > 0) {
    console.log(`     Missing: ${finalGaps.join(', ')}`);
  }
  console.log(`  💰 Total Revenue:           $${totalRev.toLocaleString()}`);
  console.log(`  📈 Average per Invoice:     $${Math.round(totalRev / finalInvoices.filter(i => i.grandTotal > 0).length).toLocaleString()}`);
  
  // Gap closure report
  const gapsClosed = missingBefore.filter(n => !finalGaps.includes(n));
  console.log(`\n  ── GAP CLOSURE REPORT ──`);
  console.log(`  Gaps before: ${missingBefore.length}`);
  console.log(`  Gaps closed: ${gapsClosed.length}`);
  console.log(`  Gaps remaining: ${finalGaps.length}`);
  if (gapsClosed.length > 0) {
    console.log(`  Closed: ${gapsClosed.join(', ')}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  return finalData;
}

main().catch(console.error);

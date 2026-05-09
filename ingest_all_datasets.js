/**
 * CareGen Alliance - Full Dataset Ingestion Script
 * Reads ALL Everfast DataSet XLSX files from OneDrive and Downloads,
 * extracts work order details (tech, address, charges), enriches
 * historical_data.json with both invoice-level and work-order-level data.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ONEDRIVE_DATASETS = path.join(
  process.env.USERPROFILE,
  'OneDrive', 'Documents', 'Everfast', 'Everfast Datasets'
);
const ONEDRIVE_INVOICES = path.join(
  process.env.USERPROFILE,
  'OneDrive', 'Documents', 'Everfast', 'Everfast invoices'
);
const DOWNLOADS = path.join(process.env.USERPROFILE, 'Downloads');
const CONSOLIDATED = path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices');
const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');

// Excel serial date to JS Date
function excelDateToJSDate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000);
}

function formatDate(d) {
  if (!d || !(d instanceof Date) || isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

/**
 * Parse a single DataSet file and extract invoice metadata + work orders
 */
function parseDataset(filePath) {
  try {
    const wb = XLSX.readFile(filePath);
    const results = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!rawData || rawData.length < 6) continue;

      // Extract header info (rows 0-5 typically)
      let invoiceDate = null, weekEnding = null, invoiceNumber = null, type = null, grandTotal = null;

      for (let r = 0; r < Math.min(8, rawData.length); r++) {
        const row = rawData[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').toUpperCase().trim();
          if (val.includes('INVOICE DATE') || val === 'INVOICE DATE:') {
            const dateVal = row[c + 1] || (row.length > c + 1 ? row[c + 1] : null);
            // Sometimes the value is 2 columns over
            const tryVal = dateVal || (row[c + 2] ? row[c + 2] : null);
            if (typeof tryVal === 'number') {
              invoiceDate = excelDateToJSDate(tryVal);
            } else if (tryVal) {
              invoiceDate = new Date(tryVal);
            }
          }
          if (val.includes('WEEK ENDING') || val === 'WEEK ENDING:') {
            const dateVal = row[c + 1] || (row.length > c + 1 ? row[c + 1] : null);
            const tryVal = dateVal || (row[c + 2] ? row[c + 2] : null);
            if (typeof tryVal === 'number') {
              weekEnding = excelDateToJSDate(tryVal);
            } else if (tryVal) {
              weekEnding = new Date(tryVal);
            }
          }
          if (val.includes('INVOICE #') || val === 'INVOICE #:') {
            const numVal = row[c + 1] || (row.length > c + 1 ? row[c + 1] : null);
            invoiceNumber = parseInt(numVal || (row[c + 2] ? row[c + 2] : 0));
          }
          if (val === 'TYPE:') {
            type = row[c + 1] || (row[c + 2] ? row[c + 2] : 'Installation');
          }
          if (val.includes('GRAND TOTAL')) {
            const totalVal = row[c + 1] || (row.length > c + 1 ? row[c + 1] : null);
            grandTotal = parseFloat(totalVal || (row[c + 2] ? row[c + 2] : 0));
          }
        }
      }

      // Try to extract invoice number from sheet name if not found in header
      if (!invoiceNumber) {
        const match = sheetName.match(/(\d+)/);
        if (match) invoiceNumber = parseInt(match[1]);
      }

      // Find the header row for work order data
      let headerRow = -1;
      let headerMapping = {};
      for (let r = 0; r < Math.min(15, rawData.length); r++) {
        const row = rawData[r];
        if (!row) continue;
        const rowStr = row.map(c => String(c || '').toUpperCase()).join('|');
        if (rowStr.includes('WORK ORDER') || rowStr.includes('TECH NAME') || rowStr.includes('SERVICES ORDER') || rowStr.includes('BASE WORK ORDER')) {
          headerRow = r;
          // Map column indices
          for (let c = 0; c < row.length; c++) {
            const hdr = String(row[c] || '').toUpperCase().trim();
            if (hdr.includes('WORK ORDER DATE') || hdr === 'DATE') headerMapping.date = c;
            if (hdr.includes('TECH NAME') || hdr === 'TECH') headerMapping.tech = c;
            if (hdr.includes('SERVICES ORDER') || hdr.includes('SERVICE ORDER') || hdr === 'ROW LABELS') headerMapping.serviceOrder = c;
            if (hdr.includes('BASE WORK ORDER TYPE') || hdr.includes('BASE WORK ORDER')) {
              if (!hdr.includes('SUM')) headerMapping.workOrderType = c;
            }
            if (hdr.includes('SUM OF BASE') || (hdr.includes('BASE WORK ORDER') && hdr.includes('SUM'))) headerMapping.baseCharge = c;
            if (hdr.includes('ADDITIONAL WORK') && !hdr.includes('SUM') && !hdr.includes('(1)') && !hdr.includes('(2)')) {
              if (headerMapping.additionalDesc1 === undefined) headerMapping.additionalDesc1 = c;
              else headerMapping.additionalDesc2 = c;
            }
            if (hdr.includes('ADDITIONAL (1)') || hdr.includes('SUM OF ADDITIONAL (1)')) headerMapping.additional1 = c;
            if (hdr.includes('ADDITIONAL (2)') || hdr.includes('SUM OF ADDITIONAL (2)')) headerMapping.additional2 = c;
            if (hdr === 'TOTAL' || hdr === 'SUM OF TOTAL') headerMapping.total = c;
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
        let lastDate = null;
        let lastTech = null;
        for (let r = headerRow + 1; r < rawData.length; r++) {
          const row = rawData[r];
          if (!row || row.length === 0) continue;

          // Skip footer/total rows
          const firstCell = String(row[0] || '').toUpperCase().trim();
          if (firstCell.includes('GRAND TOTAL') || firstCell.includes('TOTAL') || firstCell === '') {
            // Check if it's a subtotal row
            if (firstCell.includes('TOTAL')) continue;
            if (row.every(c => c === null || c === undefined || c === '')) continue;
          }

          // Extract fields
          let woDate = headerMapping.date !== undefined ? row[headerMapping.date] : null;
          let tech = headerMapping.tech !== undefined ? row[headerMapping.tech] : null;
          let serviceOrder = headerMapping.serviceOrder !== undefined ? row[headerMapping.serviceOrder] : null;
          let workOrderType = headerMapping.workOrderType !== undefined ? row[headerMapping.workOrderType] : null;
          let baseCharge = headerMapping.baseCharge !== undefined ? parseFloat(row[headerMapping.baseCharge] || 0) : 0;
          let additional1 = headerMapping.additional1 !== undefined ? parseFloat(row[headerMapping.additional1] || 0) : 0;
          let additional2 = headerMapping.additional2 !== undefined ? parseFloat(row[headerMapping.additional2] || 0) : 0;
          let total = headerMapping.total !== undefined ? parseFloat(row[headerMapping.total] || 0) : 0;

          // Handle date - use last known date if current is empty
          if (woDate && typeof woDate === 'number') {
            const d = excelDateToJSDate(woDate);
            woDate = formatDate(d);
            lastDate = woDate;
          } else if (!woDate) {
            woDate = lastDate;
          }

          // Handle tech - use last known if empty
          if (tech) {
            lastTech = String(tech).trim();
          } else {
            tech = lastTech;
          }

          // Skip if no meaningful data
          if (!serviceOrder && total === 0 && baseCharge === 0) continue;

          // If total is 0 but we have base + additional, calculate
          if (total === 0 && baseCharge > 0) {
            total = baseCharge + additional1 + additional2;
          }

          // Parse service order for address info
          let customerName = '', address = '', serviceOrderId = '';
          if (serviceOrder) {
            const parts = String(serviceOrder).split(/\r?\n/);
            customerName = (parts[0] || '').trim();
            address = (parts[1] || '').trim();
            serviceOrderId = (parts[2] || '').trim();
          }

          if (total > 0 || baseCharge > 0) {
            calculatedTotal += total || (baseCharge + additional1 + additional2);
            workOrders.push({
              date: woDate,
              tech: String(tech || '').trim(),
              customerName,
              address,
              serviceOrderId,
              workOrderType: String(workOrderType || '').trim(),
              baseCharge,
              additional1,
              additional2,
              total: total || (baseCharge + additional1 + additional2),
            });
          }
        }
      }

      // Use calculated total if grand total not found in header
      if (!grandTotal && calculatedTotal > 0) {
        grandTotal = calculatedTotal;
      }

      results.push({
        sheetName,
        source: path.basename(filePath),
        invoiceNumber,
        invoiceDate: formatDate(invoiceDate),
        weekEndingDate: formatDate(weekEnding),
        invoiceDateStr: formatDate(invoiceDate),
        grandTotal: grandTotal || calculatedTotal,
        type: type || 'Installation',
        workOrderCount: workOrders.length,
        workOrders,
      });
    }

    return results;
  } catch (err) {
    console.error(`  ✗ Error parsing ${path.basename(filePath)}: ${err.message}`);
    return [];
  }
}

/**
 * Find all dataset files across all known locations
 */
function findAllDatasetFiles() {
  const files = new Map(); // invoiceNumber -> filePath

  const searchDirs = [
    { dir: ONEDRIVE_DATASETS, pattern: /DataSet|Dataset/i },
    { dir: ONEDRIVE_INVOICES, pattern: /DataSet|Dataset/i },
    { dir: DOWNLOADS, pattern: /DataSet|Dataset/i },
    { dir: CONSOLIDATED, pattern: /DataSet|Dataset|Consolidated/i },
  ];

  for (const { dir, pattern } of searchDirs) {
    if (!fs.existsSync(dir)) {
      console.log(`  ⚠ Directory not found: ${dir}`);
      continue;
    }

    const dirFiles = fs.readdirSync(dir).filter(f =>
      f.endsWith('.xlsx') && pattern.test(f)
    );

    for (const f of dirFiles) {
      const match = f.match(/(\d+)/);
      if (match) {
        const invNum = parseInt(match[1]);
        // Skip copies/duplicates - prefer non-copy versions
        if (!files.has(invNum) || !f.includes('Copy')) {
          files.set(invNum, path.join(dir, f));
        }
      }
    }
  }

  return files;
}

/**
 * Main ingestion function
 */
async function ingestAll() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CareGen Alliance - Full Dataset Ingestion');
  console.log('═══════════════════════════════════════════════════════\n');

  // Load existing historical data
  let historicalData = { invoices: [], records: [], gaps: [] };
  if (fs.existsSync(HISTORICAL_DATA_PATH)) {
    historicalData = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));
    console.log(`📂 Existing historical data: ${historicalData.invoices.length} invoices, ${(historicalData.records || []).length} work order records\n`);
  }

  // Find all dataset files
  const allFiles = findAllDatasetFiles();
  console.log(`🔍 Found ${allFiles.size} unique dataset files across all locations\n`);

  // Track what we already have
  const existingInvNums = new Set(historicalData.invoices.map(i => i.invoiceNumber));
  const existingRecordInvNums = new Set((historicalData.records || []).map(r => r.invoiceNumber));

  let newInvoices = 0;
  let updatedInvoices = 0;
  let newRecords = 0;
  const allRecords = [...(historicalData.records || [])];
  const invoiceMap = new Map(historicalData.invoices.map(i => [i.invoiceNumber, i]));

  // Sort by invoice number for processing
  const sortedEntries = [...allFiles.entries()].sort((a, b) => a[0] - b[0]);

  for (const [invNum, filePath] of sortedEntries) {
    process.stdout.write(`  Processing Inv #${invNum}... `);

    const parsed = parseDataset(filePath);
    if (parsed.length === 0) {
      console.log('⚠ No valid data');
      continue;
    }

    for (const dataset of parsed) {
      // Update or add invoice-level data
      if (invoiceMap.has(dataset.invoiceNumber)) {
        // Update existing with richer data if available
        const existing = invoiceMap.get(dataset.invoiceNumber);
        if (dataset.weekEndingDate && !existing.weekEndingDate) {
          existing.weekEndingDate = dataset.weekEndingDate;
        }
        if (dataset.grandTotal && (!existing.grandTotal || existing.grandTotal === 0)) {
          existing.grandTotal = dataset.grandTotal;
          existing.workOrderCount = dataset.workOrderCount;
        }
        // Update work order count if we got more detail
        if (dataset.workOrders.length > 0 && dataset.workOrders.length > (existing.workOrderCount || 0)) {
          existing.workOrderCount = dataset.workOrders.length;
          existing.grandTotal = dataset.grandTotal || existing.grandTotal;
        }
        updatedInvoices++;
      } else {
        // New invoice
        invoiceMap.set(dataset.invoiceNumber, {
          sheetName: dataset.sheetName,
          source: dataset.source,
          invoiceNumber: dataset.invoiceNumber,
          invoiceDate: null,
          weekEnding: null,
          grandTotal: dataset.grandTotal,
          weekEndingDate: dataset.weekEndingDate,
          invoiceDateStr: dataset.invoiceDateStr,
          workOrderCount: dataset.workOrders.length || dataset.workOrderCount,
        });
        newInvoices++;
      }

      // Add work order records if we don't already have them for this invoice
      if (dataset.workOrders.length > 0 && !existingRecordInvNums.has(dataset.invoiceNumber)) {
        for (const wo of dataset.workOrders) {
          allRecords.push({
            invoiceNumber: dataset.invoiceNumber,
            weekEnding: dataset.weekEndingDate,
            date: wo.date,
            tech: wo.tech,
            customerName: wo.customerName,
            address: wo.address,
            serviceOrderId: wo.serviceOrderId,
            workOrderType: wo.workOrderType,
            baseCharge: wo.baseCharge,
            additional1: wo.additional1,
            additional2: wo.additional2,
            total: wo.total,
          });
          newRecords++;
        }
        existingRecordInvNums.add(dataset.invoiceNumber);
      }

      console.log(`✓ ${dataset.workOrders.length} WOs, $${(dataset.grandTotal || 0).toLocaleString()}`);
    }
  }

  // Build updated invoice list sorted by number
  const updatedInvoices_list = [...invoiceMap.values()]
    .sort((a, b) => a.invoiceNumber - b.invoiceNumber);

  // Recalculate gaps
  const allNums = updatedInvoices_list.map(i => i.invoiceNumber).filter(n => n > 0);
  const minNum = Math.min(...allNums);
  const maxNum = Math.max(...allNums);
  const gaps = [];
  for (let i = minNum; i <= maxNum; i++) {
    if (!allNums.includes(i)) gaps.push(i);
  }

  // Build final data
  const finalData = {
    extractedAt: new Date().toISOString(),
    invoices: updatedInvoices_list,
    records: allRecords,
    gaps,
  };

  // Write it out
  fs.writeFileSync(HISTORICAL_DATA_PATH, JSON.stringify(finalData, null, 2));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  INGESTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  📊 Total Invoices:   ${updatedInvoices_list.length}`);
  console.log(`  🆕 New Invoices:     ${newInvoices}`);
  console.log(`  🔄 Updated:          ${updatedInvoices}`);
  console.log(`  📋 Total Records:    ${allRecords.length}`);
  console.log(`  ➕ New Records:      ${newRecords}`);
  console.log(`  ⚠  Remaining Gaps:   ${gaps.length} (${gaps.slice(0, 15).join(', ')}${gaps.length > 15 ? '...' : ''})`);
  console.log(`  💰 Total Revenue:    $${updatedInvoices_list.reduce((s, i) => s + (i.grandTotal || 0), 0).toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════════\n');

  return finalData;
}

// Run
ingestAll().catch(console.error);

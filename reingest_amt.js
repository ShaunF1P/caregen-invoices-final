/**
 * CareGen Alliance - Enhanced Re-Ingestion
 * Handles the CareGen Group AMT invoice format from "Current Invoices.xlsx"
 * These have a different structure: Payor/Payable to/Invoice Number header rows
 * with Code/Job#/Task#/Qty/Unit Price/Total Price data rows
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const HISTORICAL_DATA_PATH = path.join(__dirname, 'data', 'historical_data.json');
const DATA_DIR = path.join(__dirname, 'data');

function excelDateToJSDate(serial) {
  if (!serial || typeof serial !== 'number' || serial > 50000 || serial < 1) return null;
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
 * Parse the CareGen Group AMT invoice format
 */
function parseAMTInvoice(ws, sheetName) {
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (!rawData || rawData.length < 10) return null;

  let invoiceNumber = null;
  let payor = null;
  let payableTo = null;
  let project = null;
  let node = null;
  let dueDate = null;
  let invoiceDate = null;
  let subtotal = 0;
  const lineItems = [];

  // Parse metadata rows
  for (let r = 0; r < Math.min(15, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;

    // Check for Invoice Number row
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      
      if (val === 'Invoice Number' || val === 'Invoice Number:') {
        // Next row, same column should have the number
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) {
          const numStr = String(nextRow[c]).replace(/[#\s]/g, '');
          const parsed = parseInt(numStr);
          if (!isNaN(parsed) && parsed > 0) invoiceNumber = parsed;
        }
      }
      
      if (val === 'Payor' || val === 'Payor:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) payor = String(nextRow[c]).trim();
      }

      if (val === 'Payable to' || val === 'Payable to:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) payableTo = String(nextRow[c]).trim();
      }

      if (val === 'Project' || val === 'Project:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) project = String(nextRow[c]).trim();
      }

      if (val === 'Node' || val === 'Node:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) node = String(nextRow[c]).trim();
      }

      if (val === 'Due date' || val === 'Due Date' || val === 'Due date:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) {
          const dateVal = nextRow[c];
          if (typeof dateVal === 'number') dueDate = excelDateToJSDate(dateVal);
          else dueDate = new Date(dateVal);
        }
      }

      if (val === 'Invoice Date' || val === 'Invoice Date:') {
        const nextRow = rawData[r + 1];
        if (nextRow && nextRow[c]) {
          const dateVal = nextRow[c];
          if (typeof dateVal === 'number') invoiceDate = excelDateToJSDate(dateVal);
          else invoiceDate = new Date(dateVal);
        }
      }
    }
  }

  // Also try to get invoice number from sheet name if not found
  if (!invoiceNumber) {
    const m = sheetName.match(/(?:Invoice)\s*#?\s*0*(\d+)/i);
    if (m) invoiceNumber = parseInt(m[1]);
  }

  // Parse line items (look for Code/Job#/Task# header or just data rows after row 14)
  let dataStartRow = -1;
  for (let r = 14; r < Math.min(20, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;
    const rowStr = row.map(c => String(c || '').toUpperCase()).join('|');
    if (rowStr.includes('CODE') || rowStr.includes('DESCRIPTION') || rowStr.includes('TASK')) {
      dataStartRow = r + 1;
      break;
    }
  }
  if (dataStartRow === -1) dataStartRow = 15; // Default

  for (let r = dataStartRow; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.length === 0) continue;

    // Check for subtotal row
    const hasSubtotal = row.some(c => String(c || '').toLowerCase().includes('subtotal'));
    if (hasSubtotal) {
      // Find the subtotal value (usually last numeric column)
      for (let c = row.length - 1; c >= 0; c--) {
        const val = row[c];
        if (typeof val === 'number' && val > 0) {
          subtotal = val;
          break;
        }
      }
      break;
    }

    // Parse line item
    const code = String(row[0] || row[1] || '').trim();
    if (!code || code === '') continue;

    // Find total price (usually last column with a number)
    let totalPrice = 0;
    for (let c = row.length - 1; c >= 0; c--) {
      if (typeof row[c] === 'number' && row[c] > 0) {
        totalPrice = row[c];
        break;
      }
    }

    if (totalPrice > 0) {
      lineItems.push({
        code,
        totalPrice,
      });
    }
  }

  // Calculate total from line items if no subtotal found
  if (subtotal === 0 && lineItems.length > 0) {
    subtotal = lineItems.reduce((s, li) => s + li.totalPrice, 0);
  }

  if (!invoiceNumber) return null;

  return {
    invoiceNumber,
    payor: payor || 'Advanced Media Technologies',
    payableTo: payableTo || 'CareGen',
    project: project || null,
    node: node || null,
    dueDate: formatDate(dueDate),
    invoiceDate: formatDate(invoiceDate),
    invoiceDateStr: formatDateStr(invoiceDate || dueDate),
    grandTotal: Math.round(subtotal * 100) / 100,
    workOrderCount: lineItems.length,
    lineItems,
  };
}

// ====================================================================
// MAIN
// ====================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CareGen Alliance - Enhanced Re-Ingestion (AMT Format)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const data = JSON.parse(fs.readFileSync(HISTORICAL_DATA_PATH, 'utf8'));
  console.log(`📂 Loaded: ${data.invoices.length} invoices\n`);

  // The invoices we need to re-parse with the AMT format parser
  const targetInvoices = data.invoices.filter(i => 
    i.grandTotal === 0 && 
    i.source && i.source.includes('Current Invoices')
  );
  
  console.log(`🎯 Invoices to re-parse: ${targetInvoices.length}\n`);

  // Open the source file
  const filePath = path.join(DATA_DIR, 'Current Invoices (1).xlsx');
  if (!fs.existsSync(filePath)) {
    console.error('Source file not found!');
    return;
  }

  const wb = XLSX.readFile(filePath);
  let updated = 0;
  let stillZero = 0;

  for (const inv of targetInvoices) {
    const sheetName = inv.sheetName;
    if (!wb.SheetNames.includes(sheetName)) {
      console.log(`   ⚠ Sheet not found: ${sheetName}`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const parsed = parseAMTInvoice(ws, sheetName);

    if (parsed && parsed.grandTotal > 0) {
      // Update the invoice in the data
      inv.grandTotal = parsed.grandTotal;
      inv.invoiceDate = parsed.invoiceDate;
      inv.invoiceDateStr = parsed.invoiceDateStr;
      inv.weekEndingDate = parsed.dueDate;
      inv.workOrderCount = parsed.workOrderCount;
      inv.billTo = parsed.payor;
      inv.type = 'AMT/CareGen Group';
      inv.project = parsed.project;
      inv.node = parsed.node;
      updated++;
      console.log(`   ✅ Inv#${parsed.invoiceNumber} | $${parsed.grandTotal.toLocaleString()} | ${parsed.workOrderCount} items | ${parsed.project || 'N/A'} | Node ${parsed.node || 'N/A'}`);
    } else {
      stillZero++;
      console.log(`   ⚠ Inv#${inv.invoiceNumber} - still $0 (${sheetName})`);
    }
  }

  // Save
  data.extractedAt = new Date().toISOString();
  
  // Recalculate gaps
  const allNums = new Set(data.invoices.map(i => i.invoiceNumber));
  data.gaps = [];
  for (let i = 1; i <= 241; i++) {
    if (!allNums.has(i)) data.gaps.push(i);
  }

  fs.writeFileSync(HISTORICAL_DATA_PATH, JSON.stringify(data, null, 2));

  // Report
  const totalRev = data.invoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const withRev = data.invoices.filter(i => i.grandTotal > 0);
  const zeroLeft = data.invoices.filter(i => !i.grandTotal || i.grandTotal === 0);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RE-INGESTION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Updated:               ${updated} invoices`);
  console.log(`  ⚠  Still $0:              ${stillZero} invoices`);
  console.log(`  📊 Total Invoices:        ${data.invoices.length}`);
  console.log(`  💰 Total Revenue:         $${totalRev.toLocaleString()}`);
  console.log(`  📈 Average per Invoice:   $${Math.round(totalRev / withRev.length).toLocaleString()}`);
  console.log(`  ⚠  Remaining $0 invoices: ${zeroLeft.length}`);
  console.log(`  ⚠  Remaining Gaps:        ${data.gaps.length} (${data.gaps.join(', ')})`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

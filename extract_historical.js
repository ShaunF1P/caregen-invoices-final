/**
 * Extract ALL historical invoice data from existing master consolidated files
 * to build the analytics baseline
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const masterFiles = [
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Master Consolidated Invoices.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Master Consolidated Invoices.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Master Consolidated updated (version 1).xlsb (1).xlsx'),
  path.join(process.env.USERPROFILE, 'Downloads', 'Master Consolidated updated.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Everfast Master.xlsx'),
];

const allInvoices = [];
const allRecords = [];

for (const filePath of masterFiles) {
  if (!fs.existsSync(filePath)) continue;
  console.log(`\n=== ${path.basename(filePath)} ===`);
  
  try {
    const wb = XLSX.readFile(filePath);
    
    for (const sheetName of wb.SheetNames) {
      if (!sheetName.startsWith('Inv ') && !sheetName.startsWith('INV ')) continue;
      
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      // Extract metadata
      const meta = { sheetName, source: path.basename(filePath) };
      for (let i = 0; i < Math.min(7, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
          const val = String(row[j] || '').toLowerCase().trim();
          if (val.includes('invoice #') && row[j+1] != null) meta.invoiceNumber = parseInt(row[j+1]) || row[j+1];
          if (val.includes('week ending') && row[j+1] != null) meta.weekEnding = row[j+1];
          if (val.includes('invoice date') && row[j+1] != null) meta.invoiceDate = row[j+1];
          if (val.includes('grand total') && row[j+1] != null) meta.grandTotal = parseFloat(String(row[j+1]).replace(/[$,]/g, '')) || 0;
        }
      }
      
      // Parse dates from serial numbers
      if (typeof meta.weekEnding === 'number' && meta.weekEnding > 40000) {
        meta.weekEndingDate = new Date((meta.weekEnding - 25569) * 86400000).toISOString().split('T')[0];
      } else if (typeof meta.weekEnding === 'string') {
        meta.weekEndingDate = meta.weekEnding;
      }
      if (typeof meta.invoiceDate === 'number' && meta.invoiceDate > 40000) {
        meta.invoiceDateStr = new Date((meta.invoiceDate - 25569) * 86400000).toISOString().split('T')[0];
      }

      // Count data rows (after header row with "Row Labels")
      let headerIdx = -1;
      let dataRowCount = 0;
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row && String(row[0] || '').toLowerCase().includes('row labels')) {
          headerIdx = i;
          continue;
        }
        if (headerIdx >= 0 && i > headerIdx && row && row[0]) {
          const first = String(row[0]).trim().toLowerCase();
          if (first !== '' && !first.includes('grand total')) dataRowCount++;
        }
      }
      
      meta.workOrderCount = dataRowCount;
      
      if (meta.invoiceNumber) {
        allInvoices.push(meta);
      }
    }
    
    // Also scan Dataset sheets for detailed record data
    for (const sheetName of wb.SheetNames) {
      if (!sheetName.startsWith('Dataset ') && !sheetName.match(/^\d+-\d+-\d+$/)) continue;
      
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      // Find header row
      let headerIdx = -1;
      for (let i = 0; i < Math.min(15, data.length); i++) {
        if (data[i] && String(data[i][0] || '').toLowerCase().includes('work order')) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) continue;
      
      for (let i = headerIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0] || String(row[0]).toLowerCase().includes('total')) continue;
        
        let dateVal = row[0];
        if (typeof dateVal === 'number' && dateVal > 40000) {
          dateVal = new Date((dateVal - 25569) * 86400000).toISOString().split('T')[0];
        }
        
        allRecords.push({
          date: dateVal,
          workOrder: String(row[1] || '').trim(),
          tech: String(row[2] || '').trim(),
          type: String(row[3] || '').trim(),
          baseAmount: parseFloat(row[6]) || 0,
          add1: parseFloat(row[7]) || 0,
          add2: parseFloat(row[8]) || 0,
          total: parseFloat(row[9]) || 0,
          source: path.basename(filePath),
          sheet: sheetName,
        });
      }
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

// Deduplicate invoices by invoice number (keep the one with most data)
const invoiceMap = new Map();
for (const inv of allInvoices) {
  const key = inv.invoiceNumber;
  if (!invoiceMap.has(key) || (inv.grandTotal > (invoiceMap.get(key).grandTotal || 0))) {
    invoiceMap.set(key, inv);
  }
}

const uniqueInvoices = [...invoiceMap.values()].sort((a, b) => (a.invoiceNumber || 0) - (b.invoiceNumber || 0));

console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY`);
console.log(`${'='.repeat(60)}`);
console.log(`Total unique invoices found: ${uniqueInvoices.length}`);
console.log(`Total detailed records: ${allRecords.length}`);
console.log(`Invoice range: #${uniqueInvoices[0]?.invoiceNumber} - #${uniqueInvoices[uniqueInvoices.length-1]?.invoiceNumber}`);

// Find gaps in invoice numbering
const invNumbers = uniqueInvoices.map(i => i.invoiceNumber).filter(n => typeof n === 'number').sort((a,b) => a-b);
const gaps = [];
for (let i = 1; i < invNumbers.length; i++) {
  if (invNumbers[i] - invNumbers[i-1] > 1) {
    for (let g = invNumbers[i-1] + 1; g < invNumbers[i]; g++) {
      gaps.push(g);
    }
  }
}
console.log(`Missing invoice numbers: ${gaps.length > 0 ? gaps.join(', ') : 'None'}`);

// Weekly totals summary
console.log(`\nInvoice History:`);
for (const inv of uniqueInvoices) {
  console.log(`  Inv #${inv.invoiceNumber}: $${(inv.grandTotal || 0).toLocaleString()} | ${inv.workOrderCount} WOs | Week: ${inv.weekEndingDate || inv.weekEnding || 'N/A'}`);
}

// Save extracted data as JSON for the analytics engine
const outputData = {
  extractedAt: new Date().toISOString(),
  invoices: uniqueInvoices,
  records: allRecords,
  gaps,
  summary: {
    totalInvoices: uniqueInvoices.length,
    totalRecords: allRecords.length,
    invoiceRange: [invNumbers[0], invNumbers[invNumbers.length - 1]],
    missingNumbers: gaps,
  },
};

const outputPath = path.join(__dirname, 'data', 'historical_data.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
console.log(`\nHistorical data saved to: ${outputPath}`);
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

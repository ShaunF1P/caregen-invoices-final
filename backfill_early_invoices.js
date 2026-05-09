/**
 * Backfill Early Invoices (#1-7, #82, #170) into historical_data.json
 * Data extracted from Gmail attachments - invoice PDFs
 * Source: "Fwd: CareGen Invoices" from James Mcbryde (12/21/2021) for #1-7
 *         Individual emails in sent folder for #82, #170
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'historical_data.json');

// All invoices extracted from Gmail
const newInvoices = [
  {
    invoiceNumber: 1,
    invoiceDate: "2021-09-27",
    weekEnding: "2021-10-02",
    grandTotal: 14640,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "9/27/2021",
    weekEndingDate: "2021-10-02",
    workOrderCount: null, // PDF invoice only - no dataset
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 2,
    invoiceDate: "2021-10-04",
    weekEnding: "2021-10-09",
    grandTotal: 12442.50,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "10/4/2021",
    weekEndingDate: "2021-10-09",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 3,
    invoiceDate: "2021-10-11",
    weekEnding: "2021-10-16",
    grandTotal: 8070,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "10/11/2021",
    weekEndingDate: "2021-10-16",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 4,
    invoiceDate: "2021-10-18",
    weekEnding: "2021-10-23",
    grandTotal: 9690,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "10/18/2021",
    weekEndingDate: "2021-10-23",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 5,
    invoiceDate: "2021-10-25",
    weekEnding: "2021-10-30",
    grandTotal: 12800,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "10/25/2021",
    weekEndingDate: "2021-10-30",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 6,
    invoiceDate: "2021-11-01",
    weekEnding: "2021-11-06",
    grandTotal: 18445,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "11/1/2021",
    weekEndingDate: "2021-11-06",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 7,
    invoiceDate: "2021-11-16",
    weekEnding: "2021-11-14",
    grandTotal: 19760,
    source: "Gmail - Fwd: CareGen Invoices (James Mcbryde 12/21/2021)",
    invoiceDateStr: "11/16/2021",
    weekEndingDate: "2021-11-14",
    workOrderCount: null,
    billTo: "Consolidated Communications, 121 South 17th Street, Matoon, IL 61938",
    type: "Installation"
  },
  {
    invoiceNumber: 82,
    invoiceDate: "2023-04-30",
    weekEnding: "2023-04-29",
    grandTotal: 6120,
    source: "Gmail - CGA Invoice and Dataset 82 (sent 5/4/23)",
    invoiceDateStr: "4/30/23",
    weekEndingDate: "2023-04-29",
    workOrderCount: null, // Dataset exists as attachment but not parsed yet
    billTo: "Everfast Fiber Networks, 9701 Lackman Rd, Lenexa, KS 66219",
    type: "Installation"
  },
  {
    invoiceNumber: 170,
    invoiceDate: "2024-12-29",
    weekEnding: "2024-12-28",
    grandTotal: 5560,
    source: "Gmail - Caregen Invoice 170 (sent 12/29/2024)",
    invoiceDateStr: "12/29/2024",
    weekEndingDate: "2024-12-28",
    workOrderCount: null,
    billTo: "Everfast Fiber Networks, 9701 Lackman Rd, Lenexa, KS 66219",
    type: "Installation"
  }
];

function run() {
  console.log('Loading historical_data.json...');
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  
  // Get existing invoice numbers
  const existingNums = new Set(data.invoices.map(inv => inv.invoiceNumber).filter(n => n != null));
  console.log(`Current repository: ${data.invoices.length} records, invoice numbers: ${Math.min(...existingNums)} to ${Math.max(...existingNums)}`);
  
  let added = 0;
  let skipped = 0;
  
  for (const inv of newInvoices) {
    if (existingNums.has(inv.invoiceNumber)) {
      // Check if existing record has dates - if not, update it
      const existingIdx = data.invoices.findIndex(e => e.invoiceNumber === inv.invoiceNumber);
      const existing = data.invoices[existingIdx];
      if (!existing.invoiceDate && inv.invoiceDate) {
        console.log(`  Updating #${inv.invoiceNumber} with date/metadata from Gmail`);
        existing.invoiceDate = inv.invoiceDate;
        existing.invoiceDateStr = inv.invoiceDateStr;
        existing.weekEndingDate = inv.weekEndingDate;
        existing.weekEnding = inv.weekEnding;
        existing.billTo = inv.billTo;
        existing.type = inv.type;
        if (inv.grandTotal && (!existing.grandTotal || existing.grandTotal === 0)) {
          existing.grandTotal = inv.grandTotal;
        }
        added++;
      } else {
        console.log(`  #${inv.invoiceNumber} already exists with dates, skipping`);
        skipped++;
      }
    } else {
      console.log(`  Adding Invoice #${inv.invoiceNumber} (${inv.invoiceDateStr}, $${inv.grandTotal.toLocaleString()})`);
      data.invoices.push({
        sheetName: `Invoice ${inv.invoiceNumber}`,
        source: inv.source,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        weekEnding: inv.weekEnding,
        grandTotal: inv.grandTotal,
        weekEndingDate: inv.weekEndingDate,
        invoiceDateStr: inv.invoiceDateStr,
        workOrderCount: inv.workOrderCount,
        billTo: inv.billTo,
        type: inv.type
      });
      existingNums.add(inv.invoiceNumber);
      added++;
    }
  }
  
  // Sort by invoice number
  data.invoices.sort((a, b) => {
    const na = a.invoiceNumber || 0;
    const nb = b.invoiceNumber || 0;
    return na - nb;
  });
  
  data.extractedAt = new Date().toISOString();
  
  // Write back
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  
  // Gap analysis
  const allNums = [...existingNums].sort((a, b) => a - b);
  const maxNum = Math.max(...allNums);
  const gaps = [];
  for (let i = 1; i <= maxNum; i++) {
    if (!existingNums.has(i)) gaps.push(i);
  }
  
  console.log(`\n=== RESULTS ===`);
  console.log(`Added/Updated: ${added}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total invoices in repository: ${data.invoices.length}`);
  console.log(`Invoice range: #${Math.min(...allNums)} to #${maxNum}`);
  console.log(`\nRemaining gaps (${gaps.length} missing):`);
  
  // Group gaps into ranges for readability
  if (gaps.length > 0) {
    let ranges = [];
    let start = gaps[0];
    let end = gaps[0];
    for (let i = 1; i < gaps.length; i++) {
      if (gaps[i] === end + 1) {
        end = gaps[i];
      } else {
        ranges.push(start === end ? `#${start}` : `#${start}-${end}`);
        start = gaps[i];
        end = gaps[i];
      }
    }
    ranges.push(start === end ? `#${start}` : `#${start}-${end}`);
    console.log(ranges.join(', '));
  } else {
    console.log('NONE - 100% COMPLETE!');
  }
}

run();

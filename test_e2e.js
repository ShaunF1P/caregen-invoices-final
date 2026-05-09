/**
 * End-to-end test: Load existing CareGen data, run QC, generate invoice
 */
const path = require('path');
const fs = require('fs');
const BASE = 'http://localhost:3500';

async function test() {
  console.log('=== E2E Test: CareGen Invoice Automation ===\n');

  // 1. Check status
  let res = await fetch(`${BASE}/api/status`);
  let data = await res.json();
  console.log(`1. Initial status: ${data.status}`);
  console.log(`   Next invoice #: ${data.nextInvoiceNumber}\n`);

  // 2. Upload the existing consolidated dataset as a weekly file
  const testFile = path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Consolidated Inv 41 7.5-7.9.xlsx');
  
  if (!fs.existsSync(testFile)) {
    console.log('Test file not found, using any available dataset...');
    return;
  }

  const fileBuffer = fs.readFileSync(testFile);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  formData.append('file', blob, 'test_dataset.xlsx');

  res = await fetch(`${BASE}/api/upload/weekly`, { method: 'POST', body: formData });
  data = await res.json();
  console.log(`2. Upload result: ${data.success ? 'SUCCESS' : 'FAILED'}`);
  if (data.success) {
    console.log(`   Records: ${data.totalRecords}`);
    console.log(`   Sheets: ${data.sheets?.map(s => `${s.sheetName} (${s.recordCount} records)`).join(', ')}\n`);
  } else {
    console.log(`   Error: ${data.error}\n`);
  }

  // 3. Run QC
  res = await fetch(`${BASE}/api/qc`, { method: 'POST' });
  data = await res.json();
  console.log(`3. QC Result: ${data.qcResults?.overallStatus}`);
  if (data.qcResults) {
    console.log(`   Passed: ${data.qcResults.passedRecords}/${data.qcResults.totalRecords}`);
    console.log(`   Warnings: ${data.qcResults.warnings}, Errors: ${data.qcResults.errors}`);
    console.log(`   Grand Total: $${data.qcResults.summary?.grandTotal?.toLocaleString()}`);
    console.log(`   Techs: ${Object.keys(data.qcResults.summary?.techTotals || {}).join(', ')}\n`);
  }

  // 4. Generate invoice
  res = await fetch(`${BASE}/api/generate-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceNumber: 999,
      weekEnding: '2026-05-04',
      invoiceDate: '2026-05-07',
    }),
  });
  data = await res.json();
  console.log(`4. Invoice Generation: ${data.success ? 'SUCCESS' : 'FAILED'}`);
  if (data.invoicePackage) {
    console.log(`   Invoice #${data.invoicePackage.invoiceNumber}`);
    console.log(`   Grand Total: $${data.invoicePackage.grandTotal?.toLocaleString()}`);
    console.log(`   Records: ${data.invoicePackage.recordCount}`);
    console.log(`   Files: ${JSON.stringify(data.invoicePackage.files)}`);
    console.log(`   Download Excel: ${data.invoicePackage.downloadLinks.excel}`);
    console.log(`   Download PDF: ${data.invoicePackage.downloadLinks.pdf}\n`);
  }

  // 5. Check master consolidated
  res = await fetch(`${BASE}/api/master-summary`);
  data = await res.json();
  console.log(`5. Master Consolidated: ${data.exists ? 'EXISTS' : 'NOT FOUND'}`);
  if (data.exists) {
    console.log(`   Sheets: ${data.sheetCount}`);
    console.log(`   Invoices: ${data.invoices?.length}`);
    data.invoices?.forEach(inv => {
      console.log(`     - ${inv.sheetName}: Grand Total $${inv.grandTotal}`);
    });
  }

  // 6. Check output files
  res = await fetch(`${BASE}/api/output-files`);
  data = await res.json();
  console.log(`\n6. Generated Files:`);
  data.files?.forEach(f => {
    console.log(`   ${f.name} (${(f.size/1024).toFixed(1)} KB)`);
  });

  // 7. Reset
  res = await fetch(`${BASE}/api/reset`, { method: 'POST' });
  console.log('\n7. Session reset for clean state.');
  
  console.log('\n=== E2E Test Complete ===');
}

test().catch(console.error);

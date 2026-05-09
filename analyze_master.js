const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Look at the Master Consolidated file to understand the central repository pattern
const masterFile = path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Master Consolidated Invoices.xlsx');

if (fs.existsSync(masterFile)) {
  console.log('=== Master Consolidated Invoices.xlsx ===');
  const wb = XLSX.readFile(masterFile);
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(`\nSheet: "${sheetName}" - ${data.length} rows`);
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i] || [];
      const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 50) : '');
      console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
    }
    if (data.length > 5) console.log(`  ... (${data.length - 5} more rows)`);
  }
}

// Also check the Downloads master consolidated 
const dlMaster = path.join(process.env.USERPROFILE, 'Downloads', 'Master Consolidated updated.xlsx');
if (fs.existsSync(dlMaster)) {
  console.log('\n=== Master Consolidated updated.xlsx ===');
  const wb = XLSX.readFile(dlMaster);
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(`\nSheet: "${sheetName}" - ${data.length} rows`);
    for (let i = 0; i < Math.min(8, data.length); i++) {
      const row = data[i] || [];
      const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 50) : '');
      console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
    }
    if (data.length > 8) console.log(`  ... (${data.length - 8} more rows)`);
  }
}

// Check for any recent Everfast datasets to see that pattern too
const efMaster = path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Master Consolidated Invoices.xlsx');
if (fs.existsSync(efMaster)) {
  console.log('\n=== Everfast Master Consolidated Invoices.xlsx ===');
  const wb = XLSX.readFile(efMaster);
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(`\nSheet: "${sheetName}" - ${data.length} rows`);
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i] || [];
      const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 50) : '');
      console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
    }
    if (data.length > 5) console.log(`  ... (${data.length - 5} more rows)`);
  }
}

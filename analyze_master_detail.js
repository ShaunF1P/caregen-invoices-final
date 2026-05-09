const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Look at the most recent Everfast Master to understand the consolidated structure
const efMaster = path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Everfast Master.xlsx');

if (fs.existsSync(efMaster)) {
  console.log('=== Everfast Master.xlsx - DETAILED STRUCTURE ===');
  const wb = XLSX.readFile(efMaster);
  console.log(`Sheet names: ${wb.SheetNames.join(', ')}`);
  console.log(`Total sheets: ${wb.SheetNames.length}`);
  
  // Show first sheet (should be master data)
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log(`\nFirst Sheet: "${wb.SheetNames[0]}" - ${data.length} rows`);
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i] || [];
    const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 45) : '');
    console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
  }
  
  // Show last few rows
  if (data.length > 15) {
    console.log(`  ...`);
    for (let i = Math.max(15, data.length - 3); i < data.length; i++) {
      const row = data[i] || [];
      const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 45) : '');
      console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
    }
  }
  
  // Show second sheet if it exists
  if (wb.SheetNames.length > 1) {
    const ws2 = wb.Sheets[wb.SheetNames[1]];
    const data2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
    console.log(`\nSecond Sheet: "${wb.SheetNames[1]}" - ${data2.length} rows`);
    for (let i = 0; i < Math.min(10, data2.length); i++) {
      const row = data2[i] || [];
      const vals = row.map(v => v !== null && v !== undefined ? String(v).substring(0, 45) : '');
      console.log(`  Row ${i+1}: ${JSON.stringify(vals)}`);
    }
  }
}

// Also look at the CareGen rate data from Downloads
const rateFiles = [
  path.join(process.env.USERPROFILE, 'Downloads', 'Caregen Alliance Bid Sheet Upgrade.pdf'),
];

// Check for any recent CareGen datasets or Excel files in Downloads
const dlDir = path.join(process.env.USERPROFILE, 'Downloads');
const files = fs.readdirSync(dlDir);
const caregenXlsx = files.filter(f => 
  (f.toLowerCase().includes('caregen') || f.toLowerCase().includes('alliance')) && 
  (f.endsWith('.xlsx') || f.endsWith('.csv'))
);
console.log('\n=== CareGen/Alliance Excel/CSV files in Downloads ===');
caregenXlsx.forEach(f => {
  const fullPath = path.join(dlDir, f);
  const stat = fs.statSync(fullPath);
  console.log(`  ${f} - ${(stat.size/1024).toFixed(1)}KB - ${stat.mtime.toISOString().split('T')[0]}`);
});

// Read the CSV files
caregenXlsx.filter(f => f.endsWith('.csv')).forEach(f => {
  console.log(`\n=== ${f} ===`);
  const content = fs.readFileSync(path.join(dlDir, f), 'utf8');
  console.log(content.substring(0, 2000));
});

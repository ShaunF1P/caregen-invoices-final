const XLSX = require('xlsx');
const path = require('path');

// Verify the generated files match expected format
const outputFile = path.join(__dirname, 'output', 'Everfast DataSet 999.xlsx');
const masterFile = path.join(__dirname, 'data', 'master_consolidated.xlsx');

console.log('=== Generated DataSet Excel ===');
const wb1 = XLSX.readFile(outputFile);
console.log('Sheets:', wb1.SheetNames);
for (const name of wb1.SheetNames) {
  const data = XLSX.utils.sheet_to_json(wb1.Sheets[name], { header: 1 });
  console.log(`\n  ${name}: ${data.length} rows`);
  data.forEach((row, i) => {
    if (i < 12) console.log(`    Row ${i+1}: ${JSON.stringify(row.map(v => v !== null && v !== undefined ? String(v).substring(0,40) : ''))}`);
  });
}

console.log('\n=== Master Consolidated ===');
const wb2 = XLSX.readFile(masterFile);
console.log('Sheets:', wb2.SheetNames);
for (const name of wb2.SheetNames) {
  const data = XLSX.utils.sheet_to_json(wb2.Sheets[name], { header: 1 });
  console.log(`  ${name}: ${data.length} rows`);
}

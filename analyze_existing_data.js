const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filesToAnalyze = [
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Dataset 47 & 48.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Dataset 46.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Create invoice 46.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Consolidated Inv 41 7.5-7.9.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Master Consolidated updated (version 1).xlsb (1).xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Consolidated Invoices', 'Master Consolidated Inv 41 7.5-7.9.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Master Consolidated Invoices.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Master Consolidated Invoices.xlsx'),
  path.join(process.env.USERPROFILE, 'OneDrive', 'Documents', 'Everfast', 'Everfast invoices', 'Everfast Master.xlsx'),
  path.join(process.env.USERPROFILE, 'Downloads', 'Master Consolidated updated.xlsx'),
];

for (const filePath of filesToAnalyze) {
  if (!fs.existsSync(filePath)) {
    console.log(`\nFILE NOT FOUND: ${path.basename(filePath)}`);
    continue;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FILE: ${path.basename(filePath)}`);
  console.log(`SIZE: ${(fs.statSync(filePath).size / 1024).toFixed(1)} KB`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    const wb = XLSX.readFile(filePath);
    
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      console.log(`\n  Sheet: "${sheetName}"`);
      console.log(`  Rows: ${data.length}, Cols: ${range.e.c + 1}`);
      
      // Print first 12 rows
      const rowsToPrint = Math.min(12, data.length);
      for (let i = 0; i < rowsToPrint; i++) {
        const row = data[i] || [];
        const vals = row.map(v => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return s.length > 40 ? s.substring(0, 37) + '...' : s;
        });
        console.log(`  Row ${i + 1}: ${JSON.stringify(vals)}`);
      }
      
      if (data.length > 12) {
        console.log(`  ... (${data.length - 12} more rows)`);
      }
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
}

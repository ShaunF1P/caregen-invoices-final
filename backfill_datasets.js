/**
 * CareGen Alliance — Historical Dataset Backfill
 * Populates the dataset registry from historical_data.json
 * so every past invoice shows in the Dataset Library with status/payment tracking
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, 'data', 'dataset_registry.json');
const HISTORICAL_PATH = path.join(__dirname, 'data', 'historical_data.json');

// Load historical data
const historical = JSON.parse(fs.readFileSync(HISTORICAL_PATH, 'utf8'));
console.log(`Found ${historical.invoices.length} historical invoices`);

// Load existing registry
let registry = { datasets: [] };
if (fs.existsSync(REGISTRY_PATH)) {
  registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  console.log(`Existing registry has ${registry.datasets.length} datasets`);
}

// Track existing invoice numbers to avoid duplicates
const existingInvNums = new Set(registry.datasets.map(d => d.invoiceNumber).filter(Boolean));

let added = 0;
for (const inv of historical.invoices) {
  // Skip if already in registry
  if (existingInvNums.has(inv.invoiceNumber) || existingInvNums.has(String(inv.invoiceNumber))) continue;

  const dataset = {
    id: `ds_hist_${inv.invoiceNumber}`,
    fileName: `Everfast DataSet ${inv.invoiceNumber}.xlsx`,
    savedName: null, // No physical file — historical entry
    uploadedAt: inv.weekEndingDate ? new Date(inv.weekEndingDate).toISOString() : new Date().toISOString(),
    uploadedBy: 'historical_import',
    weekEnding: inv.weekEndingDate || '',
    invoiceNumber: inv.invoiceNumber,
    status: 'archived', // All historical = archived
    paymentStatus: 'paid', // Assume all historical invoices were paid
    recordCount: inv.workOrderCount || 0,
    grandTotal: inv.grandTotal || 0,
    notes: `Historical import — Invoice #${inv.invoiceNumber}${inv.source ? ` (${inv.source})` : ''}`,
  };

  registry.datasets.push(dataset);
  existingInvNums.add(inv.invoiceNumber);
  added++;
}

// Sort by invoice number descending (newest first)
registry.datasets.sort((a, b) => {
  const aNum = parseInt(a.invoiceNumber) || 0;
  const bNum = parseInt(b.invoiceNumber) || 0;
  return bNum - aNum;
});

// Save
fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
console.log(`Added ${added} historical datasets to registry`);
console.log(`Total datasets in registry: ${registry.datasets.length}`);

// Summary stats
const statusCounts = {};
const paymentCounts = {};
registry.datasets.forEach(d => {
  statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
  paymentCounts[d.paymentStatus] = (paymentCounts[d.paymentStatus] || 0) + 1;
});
console.log('\nBy status:', statusCounts);
console.log('By payment:', paymentCounts);

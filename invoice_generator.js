/**
 * CareGen Alliance Invoice Automation - Invoice Generator
 * Generates Excel invoices (dataset + pivot table) and PDF invoices
 */

const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class InvoiceGenerator {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    [config.paths.outputDir, config.paths.archiveDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  /**
   * Generate the complete invoice package:
   * 1. Dataset Excel (raw data sheet)
   * 2. Invoice Excel (pivot table sheet)
   * 3. PDF Invoice
   * Returns paths to all generated files
   */
  generateInvoicePackage(records, invoiceNumber, weekEnding, invoiceDate = null) {
    if (!invoiceDate) {
      invoiceDate = new Date();
    }

    const weekEndingStr = this._formatDate(weekEnding);
    const invoiceDateStr = this._formatDate(invoiceDate);

    // Generate the combined Excel workbook (Dataset + Invoice sheets)
    const excelPath = this._generateExcelWorkbook(records, invoiceNumber, weekEndingStr, invoiceDateStr);

    // Generate PDF invoice
    const pdfPath = this._generatePDFInvoice(records, invoiceNumber, weekEndingStr, invoiceDateStr);

    return {
      excelPath,
      pdfPath,
      invoiceNumber,
      weekEnding: weekEndingStr,
      invoiceDate: invoiceDateStr,
      grandTotal: records.reduce((sum, r) => sum + (r.total || 0), 0),
      recordCount: records.length,
    };
  }

  /**
   * Generate Excel workbook with Dataset and Invoice (pivot) sheets
   */
  _generateExcelWorkbook(records, invoiceNumber, weekEnding, invoiceDate) {
    const wb = XLSX.utils.book_new();

    // === DATASET SHEET ===
    const datasetRows = [];
    
    // Header block
    datasetRows.push([config.company.name]);
    datasetRows.push([`Bill To: ${config.company.billTo}`, null, 'INVOICE DATE:', invoiceDate]);
    datasetRows.push([`Attn: ${config.company.billToAttn}`, null, 'Week Ending:', weekEnding]);
    datasetRows.push([config.company.billToAddress, null, 'INVOICE #:', invoiceNumber]);
    datasetRows.push([config.company.billToCity, null, 'Type:', config.company.type]);
    datasetRows.push([null, null, 'PO Number:']);
    
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);
    datasetRows.push([null, null, 'Total', grandTotal]);
    
    // Column headers
    datasetRows.push([
      'Work Order Date', 'Work Order Number', 'Tech Name', 'Base Work Order Type',
      'Additional Work Performed (Not On Order)', 'Additional Work Performed (Not On Order)',
      'Base Work Order', 'Additional (1)', 'Additional (2)', 'Total'
    ]);

    // Data rows
    for (const record of records) {
      datasetRows.push([
        record.workOrderDate || '',
        record.workOrderNumber || '',
        record.techName || '',
        record.baseWorkOrderType || '',
        record.additionalWork1 || '',
        record.additionalWork2 || '',
        record.baseWorkOrderAmount || '',
        record.additionalAmount1 || '',
        record.additionalAmount2 || '',
        record.total || 0,
      ]);
    }

    // Totals row
    datasetRows.push([
      '', '', '', '', '', '', '', '', 'Grand Total:', grandTotal
    ]);

    const datasetWs = XLSX.utils.aoa_to_sheet(datasetRows);
    
    // Set column widths
    datasetWs['!cols'] = [
      { wch: 15 }, { wch: 18 }, { wch: 20 }, { wch: 30 },
      { wch: 35 }, { wch: 35 },
      { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    ];

    XLSX.utils.book_append_sheet(wb, datasetWs, `Dataset ${invoiceNumber}`);

    // === INVOICE (PIVOT) SHEET ===
    const pivotRows = [];
    
    // Header block
    pivotRows.push([config.company.name, null, 'INVOICE DATE:', invoiceDate]);
    pivotRows.push([`Bill To: ${config.company.billTo}`, null, 'Week Ending:', weekEnding]);
    pivotRows.push([`Attn: ${config.company.billToAttn}`, null, 'INVOICE #:', invoiceNumber]);
    pivotRows.push([config.company.billToAddress, null, 'Type:', config.company.type]);
    pivotRows.push([config.company.billToCity, null, 'Grand Total ', grandTotal]);

    // Pivot header
    pivotRows.push([
      'Row Labels', 'Sum of Base Work Order', 'Sum of Additional (1)', 
      'Sum of Additional (2)', 'Sum of Total'
    ]);

    // Pivot data - aggregate by Work Order Number
    const pivotMap = new Map();
    for (const record of records) {
      const woNum = record.workOrderNumber;
      if (pivotMap.has(woNum)) {
        const existing = pivotMap.get(woNum);
        existing.baseWorkOrder += record.baseWorkOrderAmount || 0;
        existing.additional1 += record.additionalAmount1 || 0;
        existing.additional2 += record.additionalAmount2 || 0;
        existing.total += record.total || 0;
      } else {
        pivotMap.set(woNum, {
          baseWorkOrder: record.baseWorkOrderAmount || 0,
          additional1: record.additionalAmount1 || 0,
          additional2: record.additionalAmount2 || 0,
          total: record.total || 0,
        });
      }
    }

    // Sort by work order number
    const sortedWOs = [...pivotMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    
    let totalBase = 0, totalAdd1 = 0, totalAdd2 = 0, totalAll = 0;
    for (const [woNum, data] of sortedWOs) {
      pivotRows.push([
        woNum,
        data.baseWorkOrder || '',
        data.additional1 || '',
        data.additional2 || '',
        data.total,
      ]);
      totalBase += data.baseWorkOrder;
      totalAdd1 += data.additional1;
      totalAdd2 += data.additional2;
      totalAll += data.total;
    }

    // Grand total row
    pivotRows.push(['Grand Total', totalBase, totalAdd1, totalAdd2, totalAll]);

    const pivotWs = XLSX.utils.aoa_to_sheet(pivotRows);
    pivotWs['!cols'] = [
      { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
    ];

    XLSX.utils.book_append_sheet(wb, pivotWs, `Inv ${invoiceNumber}`);

    // Write the file
    const fileName = `${config.invoice.datasetPrefix} ${invoiceNumber}.xlsx`;
    const outputPath = path.join(config.paths.outputDir, fileName);
    XLSX.writeFile(wb, outputPath);

    return outputPath;
  }

  /**
   * Generate PDF invoice
   */
  _generatePDFInvoice(records, invoiceNumber, weekEnding, invoiceDate) {
    const fileName = `${config.invoice.prefix} ${invoiceNumber}.pdf`;
    const outputPath = path.join(config.paths.outputDir, fileName);
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const writeStream = fs.createWriteStream(outputPath);
      
      doc.pipe(writeStream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold')
        .text(config.company.name, 50, 50);
      
      doc.fontSize(10).font('Helvetica');
      doc.text(`Bill To: ${config.company.billTo}`, 50, 80);
      doc.text(`Attn: ${config.company.billToAttn}`, 50, 95);
      doc.text(config.company.billToAddress, 50, 110);
      doc.text(config.company.billToCity, 50, 125);

      // Invoice details (right side)
      doc.text(`INVOICE DATE: ${invoiceDate}`, 380, 80);
      doc.text(`Week Ending: ${weekEnding}`, 380, 95);
      doc.text(`INVOICE #: ${invoiceNumber}`, 380, 110);
      doc.text(`Type: ${config.company.type}`, 380, 125);

      // Grand total
      doc.fontSize(14).font('Helvetica-Bold');
      doc.text(`Grand Total: $${grandTotal.toLocaleString()}`, 380, 145);

      // Table header
      const tableTop = 180;
      doc.fontSize(8).font('Helvetica-Bold');
      
      const colWidths = [90, 130, 95, 95, 95];
      const colStarts = [50];
      for (let i = 1; i < colWidths.length; i++) {
        colStarts.push(colStarts[i-1] + colWidths[i-1]);
      }

      const headers = ['Row Labels', 'Sum of Base WO', 'Sum of Add (1)', 'Sum of Add (2)', 'Sum of Total'];
      
      // Header background
      doc.rect(50, tableTop - 5, 510, 18).fill('#1a237e');
      doc.fill('#ffffff');
      headers.forEach((header, i) => {
        doc.text(header, colStarts[i] + 3, tableTop, { width: colWidths[i] - 6 });
      });

      // Pivot data
      const pivotMap = new Map();
      for (const record of records) {
        const woNum = record.workOrderNumber;
        if (pivotMap.has(woNum)) {
          const existing = pivotMap.get(woNum);
          existing.baseWorkOrder += record.baseWorkOrderAmount || 0;
          existing.additional1 += record.additionalAmount1 || 0;
          existing.additional2 += record.additionalAmount2 || 0;
          existing.total += record.total || 0;
        } else {
          pivotMap.set(woNum, {
            baseWorkOrder: record.baseWorkOrderAmount || 0,
            additional1: record.additionalAmount1 || 0,
            additional2: record.additionalAmount2 || 0,
            total: record.total || 0,
          });
        }
      }

      const sortedWOs = [...pivotMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      let y = tableTop + 18;
      let totalBase = 0, totalAdd1 = 0, totalAdd2 = 0, totalAll = 0;
      let rowIdx = 0;

      doc.font('Helvetica').fontSize(7);

      for (const [woNum, data] of sortedWOs) {
        if (y > 700) {
          doc.addPage();
          y = 50;
          // Re-draw header on new page
          doc.fontSize(8).font('Helvetica-Bold');
          doc.rect(50, y - 5, 510, 18).fill('#1a237e');
          doc.fill('#ffffff');
          headers.forEach((header, i) => {
            doc.text(header, colStarts[i] + 3, y, { width: colWidths[i] - 6 });
          });
          y += 18;
          doc.font('Helvetica').fontSize(7);
        }

        // Alternating row colors
        if (rowIdx % 2 === 0) {
          doc.rect(50, y - 3, 510, 14).fill('#f5f5f5');
        }
        
        doc.fill('#000000');
        doc.text(woNum, colStarts[0] + 3, y, { width: colWidths[0] - 6 });
        doc.text(data.baseWorkOrder ? `$${data.baseWorkOrder}` : '', colStarts[1] + 3, y, { width: colWidths[1] - 6 });
        doc.text(data.additional1 ? `$${data.additional1}` : '', colStarts[2] + 3, y, { width: colWidths[2] - 6 });
        doc.text(data.additional2 ? `$${data.additional2}` : '', colStarts[3] + 3, y, { width: colWidths[3] - 6 });
        doc.text(`$${data.total}`, colStarts[4] + 3, y, { width: colWidths[4] - 6 });

        totalBase += data.baseWorkOrder;
        totalAdd1 += data.additional1;
        totalAdd2 += data.additional2;
        totalAll += data.total;

        y += 14;
        rowIdx++;
      }

      // Grand total row
      y += 5;
      doc.rect(50, y - 3, 510, 18).fill('#1a237e');
      doc.fill('#ffffff').fontSize(9).font('Helvetica-Bold');
      doc.text('Grand Total', colStarts[0] + 3, y);
      doc.text(`$${totalBase.toLocaleString()}`, colStarts[1] + 3, y);
      doc.text(`$${totalAdd1.toLocaleString()}`, colStarts[2] + 3, y);
      doc.text(`$${totalAdd2.toLocaleString()}`, colStarts[3] + 3, y);
      doc.text(`$${totalAll.toLocaleString()}`, colStarts[4] + 3, y);

      // Footer
      doc.fontSize(8).fill('#666666').font('Helvetica');
      doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 740);
      doc.text('CareGen Alliance Invoice Automation', 350, 740);

      doc.end();

      writeStream.on('finish', () => resolve(outputPath));
      writeStream.on('error', reject);
    });
  }

  /**
   * Append invoice data to the master consolidated workbook
   */
  updateMasterConsolidated(records, invoiceNumber, weekEnding, invoiceDate) {
    const masterPath = config.paths.masterFile;
    let wb;

    if (fs.existsSync(masterPath)) {
      wb = XLSX.readFile(masterPath);
    } else {
      wb = XLSX.utils.book_new();
      
      // Create Rates sheet
      const ratesData = [['Job Type', 'Rate']];
      for (const [type, rate] of Object.entries(config.rates)) {
        ratesData.push([type, rate]);
      }
      const ratesWs = XLSX.utils.aoa_to_sheet(ratesData);
      ratesWs['!cols'] = [{ wch: 50 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ratesWs, 'Rates');
    }

    const weekEndingStr = this._formatDate(weekEnding);
    const invoiceDateStr = this._formatDate(invoiceDate || new Date());

    // Add Dataset sheet
    const datasetSheetName = `Dataset ${invoiceNumber}`;
    if (!wb.SheetNames.includes(datasetSheetName)) {
      const datasetRows = this._buildDatasetRows(records, invoiceNumber, weekEndingStr, invoiceDateStr);
      const datasetWs = XLSX.utils.aoa_to_sheet(datasetRows);
      datasetWs['!cols'] = [
        { wch: 15 }, { wch: 18 }, { wch: 20 }, { wch: 30 },
        { wch: 35 }, { wch: 35 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, datasetWs, datasetSheetName);
    }

    // Add Invoice (Pivot) sheet
    const invSheetName = `Inv ${invoiceNumber}`;
    if (!wb.SheetNames.includes(invSheetName)) {
      const pivotRows = this._buildPivotRows(records, invoiceNumber, weekEndingStr, invoiceDateStr);
      const pivotWs = XLSX.utils.aoa_to_sheet(pivotRows);
      pivotWs['!cols'] = [
        { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
      ];
      XLSX.utils.book_append_sheet(wb, pivotWs, invSheetName);
    }

    XLSX.writeFile(wb, masterPath);
    return masterPath;
  }

  /**
   * Build dataset rows for a sheet
   */
  _buildDatasetRows(records, invoiceNumber, weekEnding, invoiceDate) {
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);
    const rows = [];
    
    rows.push([config.company.name]);
    rows.push([`Bill To: ${config.company.billTo}`, null, 'INVOICE DATE:', invoiceDate]);
    rows.push([`Attn: ${config.company.billToAttn}`, null, 'Week Ending:', weekEnding]);
    rows.push([config.company.billToAddress, null, 'INVOICE #:', invoiceNumber]);
    rows.push([config.company.billToCity, null, 'Type:', config.company.type]);
    rows.push([null, null, 'PO Number:']);
    rows.push([null, null, 'Total', grandTotal]);
    
    rows.push([
      'Work Order Date', 'Work Order Number', 'Tech Name', 'Base Work Order Type',
      'Additional Work Performed (Not On Order)', 'Additional Work Performed (Not On Order)',
      'Base Work Order', 'Additional (1)', 'Additional (2)', 'Total'
    ]);

    for (const record of records) {
      rows.push([
        record.workOrderDate || '', record.workOrderNumber || '',
        record.techName || '', record.baseWorkOrderType || '',
        record.additionalWork1 || '', record.additionalWork2 || '',
        record.baseWorkOrderAmount || '', record.additionalAmount1 || '',
        record.additionalAmount2 || '', record.total || 0,
      ]);
    }

    rows.push(['', '', '', '', '', '', '', '', 'Grand Total:', grandTotal]);
    return rows;
  }

  /**
   * Build pivot table rows
   */
  _buildPivotRows(records, invoiceNumber, weekEnding, invoiceDate) {
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);
    const rows = [];

    rows.push([config.company.name, null, 'INVOICE DATE:', invoiceDate]);
    rows.push([`Bill To: ${config.company.billTo}`, null, 'Week Ending:', weekEnding]);
    rows.push([`Attn: ${config.company.billToAttn}`, null, 'INVOICE #:', invoiceNumber]);
    rows.push([config.company.billToAddress, null, 'Type:', config.company.type]);
    rows.push([config.company.billToCity, null, 'Grand Total ', grandTotal]);

    rows.push(['Row Labels', 'Sum of Base Work Order', 'Sum of Additional (1)', 'Sum of Additional (2)', 'Sum of Total']);

    const pivotMap = new Map();
    for (const record of records) {
      const woNum = record.workOrderNumber;
      if (pivotMap.has(woNum)) {
        const existing = pivotMap.get(woNum);
        existing.baseWorkOrder += record.baseWorkOrderAmount || 0;
        existing.additional1 += record.additionalAmount1 || 0;
        existing.additional2 += record.additionalAmount2 || 0;
        existing.total += record.total || 0;
      } else {
        pivotMap.set(woNum, {
          baseWorkOrder: record.baseWorkOrderAmount || 0,
          additional1: record.additionalAmount1 || 0,
          additional2: record.additionalAmount2 || 0,
          total: record.total || 0,
        });
      }
    }

    const sortedWOs = [...pivotMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let totalBase = 0, totalAdd1 = 0, totalAdd2 = 0, totalAll = 0;

    for (const [woNum, data] of sortedWOs) {
      rows.push([woNum, data.baseWorkOrder || '', data.additional1 || '', data.additional2 || '', data.total]);
      totalBase += data.baseWorkOrder;
      totalAdd1 += data.additional1;
      totalAdd2 += data.additional2;
      totalAll += data.total;
    }

    rows.push(['Grand Total', totalBase, totalAdd1, totalAdd2, totalAll]);
    return rows;
  }

  /**
   * Get the next invoice number from the master consolidated file
   */
  getNextInvoiceNumber() {
    const masterPath = config.paths.masterFile;
    if (!fs.existsSync(masterPath)) return config.invoice.startingNumber;

    try {
      const wb = XLSX.readFile(masterPath);
      const invSheets = wb.SheetNames.filter(s => s.startsWith('Inv '));
      if (invSheets.length === 0) return config.invoice.startingNumber;

      const numbers = invSheets.map(s => parseInt(s.replace('Inv ', '')) || 0);
      return Math.max(...numbers) + 1;
    } catch (e) {
      return config.invoice.startingNumber;
    }
  }

  /**
   * Format a date value to string
   */
  _formatDate(val) {
    if (!val) return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    // Excel serial date
    if (typeof val === 'number' && val > 40000) {
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    }
    return String(val);
  }
}

module.exports = InvoiceGenerator;

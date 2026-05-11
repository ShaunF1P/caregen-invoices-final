/**
 * CareGen Alliance Invoice Automation - Invoice Generator
 * Generates client-ready Excel datasets and PDF invoices
 * Format matches the actual invoices sent to EverFast
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
   * 1. Dataset Excel (client-facing raw data)
   * 2. PDF Invoice (professional summary)
   * Archives both files persistently
   */
  async generateInvoicePackage(records, invoiceNumber, weekEnding, invoiceDate = null) {
    if (!invoiceDate) invoiceDate = new Date();

    const weekEndingStr = this._formatDate(weekEnding);
    const invoiceDateStr = this._formatDate(invoiceDate);

    // Generate client-ready Excel dataset
    const excelPath = this._generateDatasetExcel(records, invoiceNumber, weekEndingStr, invoiceDateStr);

    // Generate professional PDF invoice
    const pdfPath = await this._generatePDFInvoice(records, invoiceNumber, weekEndingStr, invoiceDateStr);

    // Archive copies (after PDF is fully written)
    this._archiveInvoice(invoiceNumber, excelPath, pdfPath, records, weekEndingStr, invoiceDateStr);

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
   * Generate client-facing Excel dataset
   * Matches the exact format of the real datasets sent to EverFast
   */
  _generateDatasetExcel(records, invoiceNumber, weekEnding, invoiceDate) {
    const wb = XLSX.utils.book_new();
    const rows = [];
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);

    // ── Header block (matches real Dataset 241) ──────────────
    rows.push([config.company.name]);
    rows.push([`Bill To: ${config.company.billTo}`, '', 'INVOICE DATE:', invoiceDate]);
    rows.push([`Attn: ${config.company.billToAttn}`, '', 'Week Ending:', weekEnding]);
    rows.push([config.company.billToAddress, '', 'INVOICE #:', invoiceNumber]);
    rows.push([config.company.billToCity, '', 'Type:', config.company.type]);

    // ── Column headers ───────────────────────────────────────
    rows.push([
      'Work Order Date',
      'Tech Name',
      'Services Order',
      'Base Work Order Type',
      'Additional Work Performed (Not On Order)',
      'Additional Work Performed (Not On Order)',
      'Base Work Order',
      'Additional (1)',
      'Additional (2)',
      'Total',
    ]);

    // ── Data rows ────────────────────────────────────────────
    for (const record of records) {
      rows.push([
        record.workOrderDate || record.date || '',
        record.techName || record.tech || '',
        record.serviceOrder || record.serviceOrderId || record.workOrderNumber || '',
        record.baseWorkOrderType || record.workOrderType || '',
        record.additionalWork1 || '',
        record.additionalWork2 || '',
        record.baseWorkOrderAmount || record.baseCharge || '',
        record.additionalAmount1 || record.additional1 || '',
        record.additionalAmount2 || record.additional2 || '',
        record.total || 0,
      ]);
    }

    // ── Grand Total row ──────────────────────────────────────
    rows.push(['', '', '', '', '', '', '', '', 'Grand Total:', grandTotal]);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths to match the client format
    ws['!cols'] = [
      { wch: 14 },  // Work Order Date
      { wch: 18 },  // Tech Name
      { wch: 35 },  // Services Order
      { wch: 28 },  // Base Work Order Type
      { wch: 32 },  // Additional Work 1
      { wch: 32 },  // Additional Work 2
      { wch: 14 },  // Base Work Order
      { wch: 13 },  // Additional (1)
      { wch: 13 },  // Additional (2)
      { wch: 10 },  // Total
    ];

    XLSX.utils.book_append_sheet(wb, ws, `Data Set ${invoiceNumber}`);

    const fileName = `${config.invoice.datasetPrefix} ${invoiceNumber}.xlsx`;
    const outputPath = path.join(config.paths.outputDir, fileName);
    XLSX.writeFile(wb, outputPath);

    return outputPath;
  }

  /**
   * Generate professional PDF invoice for the client
   * Clean pivot-style summary grouped by work order
   */
  _generatePDFInvoice(records, invoiceNumber, weekEnding, invoiceDate) {
    const fileName = `${config.invoice.prefix} ${invoiceNumber}.pdf`;
    const outputPath = path.join(config.paths.outputDir, fileName);
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);

      // ── Company Header ─────────────────────────────────────
      doc.fontSize(22).font('Helvetica-Bold')
        .fillColor('#004797')
        .text(config.company.name, 50, 45);

      doc.moveTo(50, 72).lineTo(562, 72).strokeColor('#FDB913').lineWidth(2).stroke();

      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      doc.text(`Bill To: ${config.company.billTo}`, 50, 85);
      doc.text(`Attn: ${config.company.billToAttn}`, 50, 100);
      doc.text(config.company.billToAddress, 50, 115);
      doc.text(config.company.billToCity, 50, 130);

      // ── Invoice Details (right side) ───────────────────────
      doc.font('Helvetica-Bold').fillColor('#333333');
      doc.text('INVOICE DATE:', 380, 85, { continued: true }).font('Helvetica').text(`  ${invoiceDate}`);
      doc.font('Helvetica-Bold').text('Week Ending:', 380, 100, { continued: true }).font('Helvetica').text(`  ${weekEnding}`);
      doc.font('Helvetica-Bold').text('INVOICE #:', 380, 115, { continued: true }).font('Helvetica').text(`  ${invoiceNumber}`);
      doc.font('Helvetica-Bold').text('Type:', 380, 130, { continued: true }).font('Helvetica').text(`  ${config.company.type}`);

      // ── Grand Total banner ─────────────────────────────────
      doc.rect(380, 148, 182, 26).fill('#004797');
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#FDB913');
      doc.text(`Grand Total: $${grandTotal.toLocaleString()}`, 390, 154);

      // ── Build pivot data by work order ─────────────────────
      const pivotMap = new Map();
      for (const record of records) {
        const woNum = record.workOrderNumber || record.serviceOrderId || record.serviceOrder || '';
        if (pivotMap.has(woNum)) {
          const existing = pivotMap.get(woNum);
          existing.baseWorkOrder += record.baseWorkOrderAmount || record.baseCharge || 0;
          existing.additional1 += record.additionalAmount1 || record.additional1 || 0;
          existing.additional2 += record.additionalAmount2 || record.additional2 || 0;
          existing.total += record.total || 0;
        } else {
          pivotMap.set(woNum, {
            baseWorkOrder: record.baseWorkOrderAmount || record.baseCharge || 0,
            additional1: record.additionalAmount1 || record.additional1 || 0,
            additional2: record.additionalAmount2 || record.additional2 || 0,
            total: record.total || 0,
          });
        }
      }

      const sortedWOs = [...pivotMap.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      // ── Table ──────────────────────────────────────────────
      const colWidths = [110, 120, 95, 95, 92];
      const colStarts = [50];
      for (let i = 1; i < colWidths.length; i++) colStarts.push(colStarts[i - 1] + colWidths[i - 1]);
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);

      const headers = ['Work Order', 'Base Work Order', 'Additional (1)', 'Additional (2)', 'Total'];

      let tableTop = 195;

      const drawTableHeader = (y) => {
        doc.rect(50, y - 4, tableWidth, 20).fill('#004797');
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
        headers.forEach((h, i) => {
          doc.text(h, colStarts[i] + 5, y, { width: colWidths[i] - 10 });
        });
        return y + 20;
      };

      let y = drawTableHeader(tableTop);
      let totalBase = 0, totalAdd1 = 0, totalAdd2 = 0, totalAll = 0;
      let rowIdx = 0;

      doc.font('Helvetica').fontSize(7.5);

      for (const [woNum, data] of sortedWOs) {
        if (y > 710) {
          doc.addPage();
          y = drawTableHeader(50);
          doc.font('Helvetica').fontSize(7.5);
        }

        // Alternating row background
        if (rowIdx % 2 === 0) {
          doc.rect(50, y - 3, tableWidth, 14).fill('#f0f4f8');
        }

        doc.fillColor('#333333');
        doc.text(String(woNum), colStarts[0] + 5, y, { width: colWidths[0] - 10 });
        doc.text(data.baseWorkOrder ? `$${data.baseWorkOrder.toLocaleString()}` : '', colStarts[1] + 5, y, { width: colWidths[1] - 10 });
        doc.text(data.additional1 ? `$${data.additional1.toLocaleString()}` : '', colStarts[2] + 5, y, { width: colWidths[2] - 10 });
        doc.text(data.additional2 ? `$${data.additional2.toLocaleString()}` : '', colStarts[3] + 5, y, { width: colWidths[3] - 10 });
        doc.text(`$${data.total.toLocaleString()}`, colStarts[4] + 5, y, { width: colWidths[4] - 10 });

        totalBase += data.baseWorkOrder;
        totalAdd1 += data.additional1;
        totalAdd2 += data.additional2;
        totalAll += data.total;

        y += 14;
        rowIdx++;
      }

      // Grand total row
      y += 4;
      doc.rect(50, y - 3, tableWidth, 20).fill('#004797');
      doc.fillColor('#FDB913').fontSize(9).font('Helvetica-Bold');
      doc.text('Grand Total', colStarts[0] + 5, y);
      doc.text(`$${totalBase.toLocaleString()}`, colStarts[1] + 5, y);
      doc.text(`$${totalAdd1.toLocaleString()}`, colStarts[2] + 5, y);
      doc.text(`$${totalAdd2.toLocaleString()}`, colStarts[3] + 5, y);
      doc.text(`$${totalAll.toLocaleString()}`, colStarts[4] + 5, y);

      // Footer — subtle, professional
      doc.fontSize(7).fillColor('#999999').font('Helvetica');
      doc.text(`${config.company.name}`, 50, 745);
      doc.text(`Invoice #${invoiceNumber}  •  ${invoiceDate}`, 350, 745, { align: 'right', width: 212 });

      doc.end();

      writeStream.on('finish', () => resolve(outputPath));
      writeStream.on('error', reject);
    });
  }

  /**
   * Archive generated files persistently
   */
  _archiveInvoice(invoiceNumber, excelPath, pdfPath, records, weekEnding, invoiceDate) {
    const archiveDir = path.join(config.paths.archiveDir, String(invoiceNumber));
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    // Copy generated files to archive
    if (typeof excelPath === 'string' && fs.existsSync(excelPath)) {
      fs.copyFileSync(excelPath, path.join(archiveDir, path.basename(excelPath)));
    }
    if (typeof pdfPath === 'string' && fs.existsSync(pdfPath)) {
      fs.copyFileSync(pdfPath, path.join(archiveDir, path.basename(pdfPath)));
    }

    // Save metadata
    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);
    const techBreakdown = {};
    records.forEach(r => {
      const t = r.techName || r.tech || 'Unknown';
      techBreakdown[t] = (techBreakdown[t] || 0) + (r.total || 0);
    });

    const metadata = {
      invoiceNumber,
      weekEnding,
      invoiceDate,
      grandTotal,
      recordCount: records.length,
      techBreakdown,
      createdAt: new Date().toISOString(),
      files: {
        excel: path.basename(excelPath),
        pdf: typeof pdfPath === 'string' ? path.basename(pdfPath) : null,
      },
    };

    fs.writeFileSync(
      path.join(archiveDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Update invoice history registry
    this._updateHistoryRegistry(metadata);

    return archiveDir;
  }

  /**
   * Update the central invoice history registry
   */
  _updateHistoryRegistry(metadata) {
    const historyPath = path.join(config.paths.dataDir, 'invoice_history.json');
    let history = { invoices: [] };

    if (fs.existsSync(historyPath)) {
      try { history = JSON.parse(fs.readFileSync(historyPath, 'utf8')); }
      catch (e) { /* start fresh */ }
    }

    // Remove existing entry for this invoice if re-generating
    history.invoices = history.invoices.filter(
      inv => inv.invoiceNumber !== metadata.invoiceNumber
    );
    history.invoices.push(metadata);
    history.invoices.sort((a, b) => b.invoiceNumber - a.invoiceNumber);

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  }

  /**
   * Get invoice history
   */
  getInvoiceHistory() {
    const historyPath = path.join(config.paths.dataDir, 'invoice_history.json');
    if (!fs.existsSync(historyPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8')).invoices || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Get the next invoice number from historical data
   */
  getNextInvoiceNumber() {
    // Check historical data first
    const histDataPath = path.join(config.paths.dataDir, 'historical_data.json');
    if (fs.existsSync(histDataPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(histDataPath, 'utf8'));
        if (data.invoices && data.invoices.length) {
          const maxNum = Math.max(...data.invoices.map(i => i.invoiceNumber || 0));
          if (maxNum > 0) return maxNum + 1;
        }
      } catch (e) { /* fall through */ }
    }

    // Check master consolidated file
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
   * Append invoice data to the master consolidated workbook
   */
  updateMasterConsolidated(records, invoiceNumber, weekEnding, invoiceDate) {
    const masterPath = config.paths.masterFile;
    let wb;

    if (fs.existsSync(masterPath)) {
      wb = XLSX.readFile(masterPath);
    } else {
      wb = XLSX.utils.book_new();
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

    const sheetName = `Inv ${invoiceNumber}`;
    if (!wb.SheetNames.includes(sheetName)) {
      const pivotRows = this._buildPivotRows(records, invoiceNumber, weekEndingStr, invoiceDateStr);
      const pivotWs = XLSX.utils.aoa_to_sheet(pivotRows);
      pivotWs['!cols'] = [
        { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
      ];
      XLSX.utils.book_append_sheet(wb, pivotWs, sheetName);
    }

    XLSX.writeFile(wb, masterPath);
    return masterPath;
  }

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
      const woNum = record.workOrderNumber || record.serviceOrderId || '';
      if (pivotMap.has(woNum)) {
        const existing = pivotMap.get(woNum);
        existing.baseWorkOrder += record.baseWorkOrderAmount || record.baseCharge || 0;
        existing.additional1 += record.additionalAmount1 || record.additional1 || 0;
        existing.additional2 += record.additionalAmount2 || record.additional2 || 0;
        existing.total += record.total || 0;
      } else {
        pivotMap.set(woNum, {
          baseWorkOrder: record.baseWorkOrderAmount || record.baseCharge || 0,
          additional1: record.additionalAmount1 || record.additional1 || 0,
          additional2: record.additionalAmount2 || record.additional2 || 0,
          total: record.total || 0,
        });
      }
    }

    const sortedWOs = [...pivotMap.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
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

  _formatDate(val) {
    if (!val) return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    if (typeof val === 'number' && val > 40000) {
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    }
    return String(val);
  }

  /**
   * Generate a branded summary report PDF (internal use)
   * @param {object} analyticsData - from analytics engine
   * @param {string} period - 'monthly', 'quarterly', or 'custom'
   * @param {string} periodLabel - e.g. 'May 2026', 'Q2 2026'
   */
  generateSummaryReport(analyticsData, period = 'monthly', periodLabel = '') {
    if (!periodLabel) {
      const now = new Date();
      periodLabel = period === 'quarterly'
        ? `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
        : now.toLocaleString('default', { month: 'long', year: 'numeric' });
    }

    const fileName = `CareGen_Report_${periodLabel.replace(/\s+/g, '_')}.pdf`;
    const filePath = path.join(config.paths.outputDir, fileName);
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const blue = '#004797';
    const gold = '#FDB913';
    const ov = analyticsData.overview || {};
    const techs = analyticsData.techPerformance || [];
    const monthly = analyticsData.monthlyTrend || [];

    // HEADER
    doc.rect(0, 0, 612, 70).fill(blue);
    doc.fontSize(22).fillColor('#FFFFFF').text('Caregen Alliance', 50, 20);
    doc.fontSize(10).fillColor(gold).text(`Performance Report — ${periodLabel}`, 50, 46);
    doc.rect(0, 70, 612, 3).fill(gold);
    doc.moveDown(2);

    // REVENUE OVERVIEW
    const y1 = 100;
    doc.fontSize(14).fillColor(blue).text('Revenue Overview', 50, y1);
    doc.rect(50, y1 + 20, 512, 1).fill(gold);

    const metrics = [
      ['Total Revenue', `$${(ov.totalRevenue || 0).toLocaleString()}`],
      ['Everfast Revenue', `$${(ov.everfastRevenue || 0).toLocaleString()}`],
      ['Avg Weekly', `$${(ov.avgWeeklyRevenue || 0).toLocaleString()}`],
      ['Avg WOs/Week', `${ov.avgWorkOrdersPerWeek || 0}`],
      ['Revenue/WO', `$${ov.avgRevenuePerWorkOrder || 0}`],
      ['Last 4-Wk Avg', `$${(ov.last4WeekAvg || 0).toLocaleString()}`],
    ];

    let my = y1 + 30;
    doc.fontSize(10).fillColor('#333333');
    for (let i = 0; i < metrics.length; i += 2) {
      const left = metrics[i];
      const right = metrics[i + 1];
      doc.text(left[0] + ':', 60, my, { width: 150 }).text(left[1], 220, my);
      if (right) doc.text(right[0] + ':', 320, my, { width: 150 }).text(right[1], 480, my);
      my += 18;
    }

    // TECH PERFORMANCE TABLE
    my += 20;
    doc.fontSize(14).fillColor(blue).text('Technician Rankings', 50, my);
    doc.rect(50, my + 20, 512, 1).fill(gold);
    my += 30;

    // Table header
    doc.fontSize(9).fillColor('#FFFFFF');
    doc.rect(50, my, 512, 18).fill(blue);
    doc.text('TECHNICIAN', 60, my + 5, { width: 180 });
    doc.text('REVENUE', 260, my + 5, { width: 80, align: 'right' });
    doc.text('WORK ORDERS', 350, my + 5, { width: 80, align: 'right' });
    doc.text('AVG/WO', 440, my + 5, { width: 80, align: 'right' });
    my += 18;

    // Table rows
    const topTechs = techs.slice(0, 12);
    for (let i = 0; i < topTechs.length; i++) {
      const t = topTechs[i];
      if (i % 2 === 0) doc.rect(50, my, 512, 16).fill('#f5f7fa');
      doc.fontSize(9).fillColor('#333333');
      doc.text(t.name, 60, my + 4, { width: 180 });
      doc.text(`$${t.totalRevenue.toLocaleString()}`, 260, my + 4, { width: 80, align: 'right' });
      doc.text(`${t.workOrders}`, 350, my + 4, { width: 80, align: 'right' });
      doc.text(`$${t.avgPerWO}`, 440, my + 4, { width: 80, align: 'right' });
      my += 16;
    }

    // MONTHLY TREND (last 6 months)
    if (monthly.length > 0) {
      my += 20;
      if (my > 650) { doc.addPage(); my = 50; }
      doc.fontSize(14).fillColor(blue).text('Monthly Trend', 50, my);
      doc.rect(50, my + 20, 512, 1).fill(gold);
      my += 30;

      doc.fontSize(9).fillColor('#FFFFFF');
      doc.rect(50, my, 512, 18).fill(blue);
      doc.text('MONTH', 60, my + 5, { width: 120 });
      doc.text('REVENUE', 200, my + 5, { width: 80, align: 'right' });
      doc.text('INVOICES', 300, my + 5, { width: 60, align: 'right' });
      doc.text('AVG/WEEK', 380, my + 5, { width: 80, align: 'right' });
      my += 18;

      const recentMonths = monthly.slice(-6);
      for (let i = 0; i < recentMonths.length; i++) {
        const m = recentMonths[i];
        if (i % 2 === 0) doc.rect(50, my, 512, 16).fill('#f5f7fa');
        doc.fontSize(9).fillColor('#333333');
        doc.text(m.month, 60, my + 4, { width: 120 });
        doc.text(`$${m.revenue.toLocaleString()}`, 200, my + 4, { width: 80, align: 'right' });
        doc.text(`${m.invoiceCount}`, 300, my + 4, { width: 60, align: 'right' });
        doc.text(`$${m.avgWeeklyRevenue.toLocaleString()}`, 380, my + 4, { width: 80, align: 'right' });
        my += 16;
      }
    }

    // Footer
    my += 30;
    if (my > 700) { doc.addPage(); my = 50; }
    doc.fontSize(8).fillColor('#999999');
    doc.text(`Generated by CareGen Alliance Revenue Intelligence • ${new Date().toLocaleString()}`, 50, my, { align: 'center', width: 512 });
    doc.text('INTERNAL USE ONLY — NOT FOR CLIENT DISTRIBUTION', 50, my + 14, { align: 'center', width: 512 });

    doc.end();

    return new Promise((resolve) => {
      stream.on('finish', () => resolve({
        filePath,
        fileName,
        period,
        periodLabel,
        downloadLink: `/output/${fileName}`,
      }));
    });
  }
}

module.exports = InvoiceGenerator;

/**
 * CareGen Alliance Invoice Automation - Server
 * Express API server with full dashboard UI
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const DataProcessor = require('./data_processor');
const InvoiceGenerator = require('./invoice_generator');
const AnalyticsEngine = require('./analytics_engine');

const app = express();
const processor = new DataProcessor();
const generator = new InvoiceGenerator();
const analytics = new AnalyticsEngine();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(config.paths.outputDir));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(config.paths.uploadsDir)) {
      fs.mkdirSync(config.paths.uploadsDir, { recursive: true });
    }
    cb(null, config.paths.uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}_${file.originalname}`);
  },
});
const upload = multer({ storage });

// ============================================================
// STATE
// ============================================================
let currentSession = {
  dailyReports: [],
  weeklyDataset: null,
  qcResults: null,
  reconciliationResults: null,
  invoicePackage: null,
  status: 'idle', // idle, data_loaded, qc_complete, reconciled, invoice_ready
  logs: [],
};

function addLog(type, message, details = null) {
  const entry = { timestamp: new Date().toISOString(), type, message, details };
  currentSession.logs.push(entry);
  console.log(`[${type.toUpperCase()}] ${message}`);
  return entry;
}

// ============================================================
// API ROUTES
// ============================================================

// GET /api/status - Get current session state
app.get('/api/status', (req, res) => {
  res.json({
    status: currentSession.status,
    dailyReportsCount: currentSession.dailyReports.length,
    weeklyDataset: currentSession.weeklyDataset ? {
      fileName: currentSession.weeklyDataset.fileName,
      totalRecords: currentSession.weeklyDataset.totalRecords,
    } : null,
    qcResults: currentSession.qcResults ? {
      overallStatus: currentSession.qcResults.overallStatus,
      totalRecords: currentSession.qcResults.totalRecords,
      passedRecords: currentSession.qcResults.passedRecords,
      failedRecords: currentSession.qcResults.failedRecords,
      warnings: currentSession.qcResults.warnings,
      errors: currentSession.qcResults.errors,
    } : null,
    reconciliation: currentSession.reconciliationResults ? {
      reconciled: currentSession.reconciliationResults.reconciled,
      matched: currentSession.reconciliationResults.matched.length,
      missingInWeekly: currentSession.reconciliationResults.missingInWeekly.length,
      missingInDaily: currentSession.reconciliationResults.missingInDaily.length,
      discrepancies: currentSession.reconciliationResults.amountDiscrepancies.length,
    } : null,
    invoicePackage: currentSession.invoicePackage || null,
    logs: currentSession.logs.slice(-50),
    nextInvoiceNumber: generator.getNextInvoiceNumber(),
    config: {
      company: config.company,
      contacts: config.contacts,
    },
  });
});

// POST /api/upload/daily - Upload daily work report(s)
app.post('/api/upload/daily', upload.array('files'), (req, res) => {
  try {
    const results = [];
    for (const file of req.files) {
      addLog('info', `Processing daily report: ${file.originalname}`);
      const parsed = processor.parseDailyReport(file.path);
      currentSession.dailyReports.push(parsed);
      results.push({
        fileName: parsed.fileName,
        recordCount: parsed.recordCount,
        records: parsed.records.slice(0, 5), // Preview first 5
      });
      addLog('success', `Parsed ${parsed.recordCount} records from ${file.originalname}`);
    }
    currentSession.status = 'data_loaded';
    res.json({ success: true, results });
  } catch (error) {
    addLog('error', `Failed to process daily report: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/upload/weekly - Upload Marcus's compiled weekly dataset
app.post('/api/upload/weekly', upload.single('file'), (req, res) => {
  try {
    addLog('info', `Processing weekly dataset: ${req.file.originalname}`);
    const parsed = processor.parseWeeklyDataset(req.file.path);
    currentSession.weeklyDataset = parsed;
    currentSession.status = 'data_loaded';
    addLog('success', `Parsed ${parsed.totalRecords} records from ${parsed.sheets.length} sheets`);
    
    res.json({
      success: true,
      fileName: parsed.fileName,
      totalRecords: parsed.totalRecords,
      sheets: parsed.sheets.map(s => ({
        sheetName: s.sheetName,
        recordCount: s.recordCount,
        metadata: s.metadata,
      })),
    });
  } catch (error) {
    addLog('error', `Failed to process weekly dataset: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/qc - Run QC on loaded data
app.post('/api/qc', (req, res) => {
  try {
    let records = [];
    
    if (currentSession.weeklyDataset) {
      records = currentSession.weeklyDataset.allRecords;
    } else if (currentSession.dailyReports.length > 0) {
      for (const report of currentSession.dailyReports) {
        records.push(...report.records);
      }
    } else {
      return res.status(400).json({ error: 'No data loaded. Upload daily reports or weekly dataset first.' });
    }

    addLog('info', `Running QC on ${records.length} records...`);
    const qcResults = processor.runQC(records);
    currentSession.qcResults = qcResults;
    currentSession.status = 'qc_complete';

    addLog(
      qcResults.overallStatus === 'PASSED' ? 'success' : 'warning',
      `QC ${qcResults.overallStatus}: ${qcResults.passedRecords}/${qcResults.totalRecords} passed, ${qcResults.warnings} warnings, ${qcResults.errors} errors`
    );

    res.json({ success: true, qcResults });
  } catch (error) {
    addLog('error', `QC failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reconcile - Reconcile daily vs weekly
app.post('/api/reconcile', (req, res) => {
  try {
    if (currentSession.dailyReports.length === 0 || !currentSession.weeklyDataset) {
      return res.status(400).json({
        error: 'Both daily reports and weekly dataset required for reconciliation. Upload both first.',
      });
    }

    const dailyRecords = [];
    for (const report of currentSession.dailyReports) {
      dailyRecords.push(...report.records);
    }
    const weeklyRecords = currentSession.weeklyDataset.allRecords;

    addLog('info', `Reconciling ${dailyRecords.length} daily records vs ${weeklyRecords.length} weekly records...`);
    const results = processor.reconcile(dailyRecords, weeklyRecords);
    currentSession.reconciliationResults = results;
    currentSession.status = 'reconciled';

    addLog(
      results.reconciled ? 'success' : 'warning',
      `Reconciliation ${results.reconciled ? 'PASSED' : 'HAS ISSUES'}: ${results.matched.length} matched, ` +
      `${results.missingInWeekly.length} missing in weekly, ${results.missingInDaily.length} extra in weekly, ` +
      `${results.amountDiscrepancies.length} amount discrepancies`
    );

    res.json({ success: true, results });
  } catch (error) {
    addLog('error', `Reconciliation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/generate-invoice - Generate invoice package
app.post('/api/generate-invoice', async (req, res) => {
  try {
    const { invoiceNumber, weekEnding, invoiceDate } = req.body;
    
    let records = [];
    if (currentSession.weeklyDataset) {
      records = currentSession.weeklyDataset.allRecords;
    } else {
      for (const report of currentSession.dailyReports) {
        records.push(...report.records);
      }
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'No data loaded.' });
    }

    const invNum = invoiceNumber || generator.getNextInvoiceNumber();
    const wkEnd = weekEnding || new Date().toISOString().split('T')[0];
    const invDate = invoiceDate || new Date().toISOString().split('T')[0];

    addLog('info', `Generating Invoice #${invNum} for week ending ${wkEnd}...`);

    // Generate Excel (Dataset + Pivot sheets)
    const excelResult = generator._generateExcelWorkbook(records, invNum, wkEnd, invDate);
    addLog('success', `Generated Excel: ${path.basename(excelResult)}`);

    // Generate PDF
    const pdfResult = await generator._generatePDFInvoice(records, invNum, wkEnd, invDate);
    addLog('success', `Generated PDF: ${path.basename(pdfResult)}`);

    // Update Master Consolidated
    const masterResult = generator.updateMasterConsolidated(records, invNum, wkEnd, invDate);
    addLog('success', `Updated Master Consolidated: ${path.basename(masterResult)}`);

    const grandTotal = records.reduce((sum, r) => sum + (r.total || 0), 0);

    currentSession.invoicePackage = {
      invoiceNumber: invNum,
      weekEnding: wkEnd,
      invoiceDate: invDate,
      recordCount: records.length,
      grandTotal,
      files: {
        excel: path.basename(excelResult),
        pdf: path.basename(pdfResult),
        master: path.basename(masterResult),
      },
      downloadLinks: {
        excel: `/output/${path.basename(excelResult)}`,
        pdf: `/output/${path.basename(pdfResult)}`,
      },
    };

    currentSession.status = 'invoice_ready';
    addLog('success', `Invoice package #${invNum} ready! Grand Total: $${grandTotal.toLocaleString()}`);

    res.json({ success: true, invoicePackage: currentSession.invoicePackage });
  } catch (error) {
    addLog('error', `Invoice generation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reset - Reset current session
app.post('/api/reset', (req, res) => {
  currentSession = {
    dailyReports: [],
    weeklyDataset: null,
    qcResults: null,
    reconciliationResults: null,
    invoicePackage: null,
    status: 'idle',
    logs: [],
  };
  addLog('info', 'Session reset');
  res.json({ success: true });
});

// GET /api/rates - Get rate card
app.get('/api/rates', (req, res) => {
  res.json(config.rates);
});

// GET /api/master-summary - Get summary of all invoices in master
app.get('/api/master-summary', (req, res) => {
  try {
    const masterPath = config.paths.masterFile;
    if (!fs.existsSync(masterPath)) {
      return res.json({ exists: false, invoices: [] });
    }

    const XLSX_lib = require('xlsx');
    const wb = XLSX_lib.readFile(masterPath);
    const invoices = [];

    for (const sheetName of wb.SheetNames) {
      if (sheetName.startsWith('Inv ')) {
        const ws = wb.Sheets[sheetName];
        const data = XLSX_lib.utils.sheet_to_json(ws, { header: 1 });
        const meta = {};
        
        for (let i = 0; i < Math.min(6, data.length); i++) {
          const row = data[i];
          if (!row) continue;
          for (let j = 0; j < row.length; j++) {
            const val = String(row[j] || '').toLowerCase();
            if (val.includes('invoice #') && row[j+1]) meta.invoiceNumber = row[j+1];
            if (val.includes('week ending') && row[j+1]) meta.weekEnding = row[j+1];
            if (val.includes('grand total') && row[j+1]) meta.grandTotal = row[j+1];
            if (val.includes('invoice date') && row[j+1]) meta.invoiceDate = row[j+1];
          }
        }
        
        meta.sheetName = sheetName;
        meta.rowCount = data.length;
        invoices.push(meta);
      }
    }

    res.json({ exists: true, sheetCount: wb.SheetNames.length, invoices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/output-files - List generated files
app.get('/api/output-files', (req, res) => {
  try {
    if (!fs.existsSync(config.paths.outputDir)) {
      return res.json({ files: [] });
    }
    const files = fs.readdirSync(config.paths.outputDir).map(f => {
      const stat = fs.statSync(path.join(config.paths.outputDir, f));
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime,
        downloadLink: `/output/${f}`,
      };
    });
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics - Full analytics dashboard
app.get('/api/analytics', (req, res) => {
  try {
    analytics.loadHistoricalData();
    const data = analytics.getAnalytics();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`\n🧾 CareGen Alliance Invoice Automation`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/status\n`);
});

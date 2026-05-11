/**
 * CareGen Alliance Invoice Automation - Server
 * Express API server with full dashboard UI
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// ============================================================
// AUTH SYSTEM
// ============================================================
const AUTH_SECRET = process.env.AUTH_SECRET || 'caregen-alliance-2026-secret-key';
const SESSION_FILE = path.join(__dirname, 'data', 'sessions.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Persistent sessions — survive server restarts
function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      const map = new Map();
      for (const [k, v] of Object.entries(data)) {
        if (Date.now() - v.created < SESSION_TTL) map.set(k, v);
      }
      return map;
    }
  } catch (e) { /* fresh start */ }
  return new Map();
}

function saveSessions() {
  try {
    const obj = Object.fromEntries(activeSessions);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(obj, null, 2));
  } catch (e) { console.error('Session save failed:', e.message); }
}

const activeSessions = loadSessions();

// Persistent users — loadable from file
function loadUsers() {
  const defaults = {
    'admin':  { password: 'CareGen2026!', role: 'admin',  name: 'Admin' },
    'shaun':  { password: 'F1rst2026!',   role: 'admin',  name: 'Shaun Muhammad' },
    'marcus': { password: 'CareGen!',     role: 'viewer', name: 'Marcus Martin' },
  };
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) { /* use defaults */ }
  // Save defaults on first run
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2));
  return defaults;
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let USERS = loadUsers();

// Role middleware — admin only for destructive operations
function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [key, val] = c.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(val || '');
  });
  return cookies;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies['cg_session'];
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

// Auth middleware — protects all routes except login page & auth API
function authGuard(req, res, next) {
  // Allow auth endpoints
  if (req.path.startsWith('/api/auth/')) return next();
  // Allow login page assets
  if (req.path === '/login' || req.path === '/login.html') return next();
  // Allow static assets needed by login page (fonts, etc)
  if (req.path.match(/\.(css|js|woff2?|ttf|ico|png|svg)$/)) return next();

  const session = getSession(req);
  if (!session) {
    // API calls get JSON error, pages get redirected
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Please log in' });
    }
    return res.redirect('/login');
  }
  req.user = session.user;
  next();
}

app.use(authGuard);

// Login page route (before static middleware to take priority)
app.get('/login', (req, res) => {
  // If already logged in, redirect to dashboard
  const session = getSession(req);
  if (session) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Auth API
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const lower = (username || '').toLowerCase().trim();
  const user = USERS[lower];

  if (!user || user.password !== password) {
    return res.json({ success: false, message: 'Invalid username or password' });
  }

  const token = generateToken();
  activeSessions.set(token, {
    user: { username: lower, name: user.name, role: user.role },
    created: Date.now(),
  });
  saveSessions();

  res.setHeader('Set-Cookie', `cg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
  res.json({ success: true, redirect: '/', user: { name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['cg_session'];
  if (token) activeSessions.delete(token);
  saveSessions();
  res.setHeader('Set-Cookie', 'cg_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

// Password change
app.post('/api/auth/change-password', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const { currentPassword, newPassword } = req.body;
  const user = USERS[session.user.username];
  if (!user) return res.status(400).json({ error: 'User not found' });
  if (user.password !== currentPassword) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  user.password = newPassword;
  saveUsers(USERS);
  res.json({ success: true, message: 'Password changed successfully' });
});

// User management (admin only)
app.get('/api/users', requireAdmin, (req, res) => {
  const userList = Object.entries(USERS).map(([username, u]) => ({
    username, name: u.name, role: u.role,
  }));
  res.json({ users: userList });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, and name required' });
  const lower = username.toLowerCase().trim();
  if (USERS[lower]) return res.status(400).json({ error: 'Username already exists' });

  USERS[lower] = { password, name, role: role || 'viewer' };
  saveUsers(USERS);
  res.json({ success: true, message: `User '${lower}' created` });
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: session.user });
});

// Role check endpoint
app.get('/api/auth/role', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ role: session.user.role, name: session.user.name });
});

// Protected static files (after auth guard)
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

// POST /api/qc - Run QC on loaded data (admin only)
app.post('/api/qc', requireAdmin, (req, res) => {
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

// POST /api/reconcile - Reconcile daily vs weekly (admin only)
app.post('/api/reconcile', requireAdmin, (req, res) => {
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

// POST /api/generate-invoice - Generate invoice package (admin only)
app.post('/api/generate-invoice', requireAdmin, async (req, res) => {
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

    // Generate full package: Excel dataset + PDF invoice + archive
    const result = await generator.generateInvoicePackage(records, invNum, wkEnd, invDate);
    addLog('success', `Generated Dataset: ${path.basename(result.excelPath)}`);
    addLog('success', `Generated PDF: ${path.basename(result.pdfPath)}`);

    // Update Master Consolidated
    const masterResult = generator.updateMasterConsolidated(records, invNum, wkEnd, invDate);
    addLog('success', `Updated Master Consolidated: ${path.basename(masterResult)}`);

    currentSession.invoicePackage = {
      invoiceNumber: invNum,
      weekEnding: result.weekEnding,
      invoiceDate: result.invoiceDate,
      recordCount: result.recordCount,
      grandTotal: result.grandTotal,
      files: {
        excel: path.basename(result.excelPath),
        pdf: path.basename(result.pdfPath),
      },
      downloadLinks: {
        excel: `/output/${path.basename(result.excelPath)}`,
        pdf: `/output/${path.basename(result.pdfPath)}`,
      },
    };

    currentSession.status = 'invoice_ready';
    addLog('success', `Invoice #${invNum} ready! Grand Total: $${result.grandTotal.toLocaleString()}`);

    res.json({ success: true, invoicePackage: currentSession.invoicePackage });
  } catch (error) {
    addLog('error', `Invoice generation failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reset - Reset current session (admin only)
app.post('/api/reset', requireAdmin, (req, res) => {
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

// GET /api/invoices - Invoice history
app.get('/api/invoices', (req, res) => {
  try {
    const invoices = generator.getInvoiceHistory();
    const enriched = invoices.map(inv => ({
      ...inv,
      downloadLinks: {
        excel: `/archive/${inv.invoiceNumber}/${inv.files.excel}`,
        pdf: inv.files.pdf ? `/archive/${inv.invoiceNumber}/${inv.files.pdf}` : null,
      },
    }));
    res.json({ invoices: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DATASET MANAGEMENT
// ============================================================
const DATASET_REGISTRY = path.join(config.paths.dataDir, 'dataset_registry.json');
const DATASET_DIR = path.join(config.paths.dataDir, 'datasets');
if (!fs.existsSync(DATASET_DIR)) fs.mkdirSync(DATASET_DIR, { recursive: true });

function loadDatasetRegistry() {
  if (!fs.existsSync(DATASET_REGISTRY)) return { datasets: [] };
  try { return JSON.parse(fs.readFileSync(DATASET_REGISTRY, 'utf8')); }
  catch (e) { return { datasets: [] }; }
}

function saveDatasetRegistry(registry) {
  fs.writeFileSync(DATASET_REGISTRY, JSON.stringify(registry, null, 2));
}

// POST /api/datasets - Upload & register a new dataset
app.post('/api/datasets', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const session = getSession(req);
    const id = 'ds_' + Date.now();
    const ext = path.extname(req.file.originalname);
    const savedName = `${id}${ext}`;
    const savedPath = path.join(DATASET_DIR, savedName);

    // Move uploaded file to datasets directory
    fs.copyFileSync(req.file.path, savedPath);
    fs.unlinkSync(req.file.path);

    // Parse to get record count and metadata
    let recordCount = 0, grandTotal = 0, weekEnding = '', invoiceNumber = '';
    try {
      const parsed = processor.parseWeeklyDataset(savedPath);
      recordCount = parsed.totalRecords;
      grandTotal = parsed.allRecords.reduce((s, r) => s + (r.total || 0), 0);
      if (parsed.sheets.length > 0 && parsed.sheets[0].metadata) {
        weekEnding = parsed.sheets[0].metadata.weekEnding || '';
        invoiceNumber = parsed.sheets[0].metadata.invoiceNumber || '';
      }
    } catch (e) { /* non-fatal */ }

    const dataset = {
      id,
      fileName: req.file.originalname,
      savedName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session ? session.user.username : 'unknown',
      weekEnding: req.body.weekEnding || weekEnding || '',
      invoiceNumber: req.body.invoiceNumber || invoiceNumber || '',
      status: 'new', // new, processing, invoiced, archived
      paymentStatus: 'unpaid', // paid, unpaid
      recordCount,
      grandTotal,
      notes: req.body.notes || '',
    };

    const registry = loadDatasetRegistry();
    registry.datasets.unshift(dataset);
    saveDatasetRegistry(registry);

    addLog('success', `Dataset registered: ${req.file.originalname} (${recordCount} records, $${grandTotal.toLocaleString()})`);
    res.json({ success: true, dataset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/datasets - List all datasets
app.get('/api/datasets', (req, res) => {
  try {
    const registry = loadDatasetRegistry();
    res.json(registry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/datasets/:id - Update dataset status, notes, payment
app.patch('/api/datasets/:id', (req, res) => {
  try {
    const registry = loadDatasetRegistry();
    const dataset = registry.datasets.find(d => d.id === req.params.id);
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

    const { status, notes, paymentStatus, weekEnding, invoiceNumber } = req.body;
    if (status) dataset.status = status;
    if (notes !== undefined) dataset.notes = notes;
    if (paymentStatus) dataset.paymentStatus = paymentStatus;
    if (weekEnding) dataset.weekEnding = weekEnding;
    if (invoiceNumber) dataset.invoiceNumber = invoiceNumber;
    dataset.updatedAt = new Date().toISOString();

    saveDatasetRegistry(registry);
    addLog('info', `Dataset ${dataset.fileName} updated: status=${dataset.status}, payment=${dataset.paymentStatus}`);
    res.json({ success: true, dataset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/datasets/:id - Remove dataset (admin only)
app.delete('/api/datasets/:id', requireAdmin, (req, res) => {
  try {
    const registry = loadDatasetRegistry();
    const idx = registry.datasets.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Dataset not found' });

    const dataset = registry.datasets[idx];
    // Delete the file
    const filePath = path.join(DATASET_DIR, dataset.savedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    registry.datasets.splice(idx, 1);
    saveDatasetRegistry(registry);

    addLog('info', `Dataset deleted: ${dataset.fileName}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/datasets/:id/load - Load a saved dataset into the pipeline
app.get('/api/datasets/:id/load', (req, res) => {
  try {
    const registry = loadDatasetRegistry();
    const dataset = registry.datasets.find(d => d.id === req.params.id);
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

    const filePath = path.join(DATASET_DIR, dataset.savedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Dataset file missing' });

    // Parse and load into session
    const parsed = processor.parseWeeklyDataset(filePath);
    currentSession.weeklyDataset = parsed;
    currentSession.status = 'data_loaded';

    // Update dataset status
    dataset.status = 'processing';
    dataset.updatedAt = new Date().toISOString();
    saveDatasetRegistry(registry);

    addLog('success', `Loaded dataset ${dataset.fileName} into pipeline (${parsed.totalRecords} records)`);
    res.json({ success: true, totalRecords: parsed.totalRecords, sheets: parsed.sheets.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve archive files
app.use('/archive', express.static(config.paths.archiveDir));

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

// GET /api/analytics/forecast - Revenue forecasting
app.get('/api/analytics/forecast', (req, res) => {
  try {
    const data = analytics.getForecasts();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/analytics/scenario - What-if scenario
app.post('/api/analytics/scenario', requireAdmin, (req, res) => {
  try {
    const data = analytics.runScenario(req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/pnl - P&L summary
app.get('/api/analytics/pnl', (req, res) => {
  try {
    const data = analytics.getPnLSummary();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/reports/generate - Generate summary report PDF (admin only)
app.post('/api/reports/generate', requireAdmin, async (req, res) => {
  try {
    const { period, periodLabel } = req.body;
    analytics.loadHistoricalData();
    const data = analytics.getAnalytics();
    const result = await generator.generateSummaryReport(data, period || 'monthly', periodLabel || '');
    addLog('success', `Report generated: ${result.fileName}`);
    res.json({ success: true, ...result });
  } catch (error) {
    addLog('error', `Report generation failed: ${error.message}`);
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

/**
 * CareGen Alliance Invoice Automation - Dashboard JS
 */

const API = '';

// ============================================================
// STATE & INIT
// ============================================================
let state = { status: 'idle' };

document.addEventListener('DOMContentLoaded', () => {
  refreshStatus();
  loadRates();
  loadContacts();
  loadFiles();
  loadInvoiceHistory();
  setInterval(refreshStatus, 10000);

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('inv-date').value = today;
  // Default week ending to last Sunday
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  document.getElementById('inv-week-ending').value = d.toISOString().split('T')[0];
});

// ============================================================
// API CALLS
// ============================================================
async function refreshStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    state = data;
    updateUI(data);
  } catch (e) { console.error('Status fetch failed:', e); }
}

async function uploadWeekly(input) {
  if (!input.files.length) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  
  const statusEl = document.getElementById('weekly-status');
  statusEl.textContent = 'Processing...';
  statusEl.className = 'upload-status';

  try {
    const res = await fetch(`${API}/api/upload/weekly`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      statusEl.textContent = `✓ ${data.totalRecords} records from ${data.sheets.length} sheets`;
      statusEl.className = 'upload-status success';
      document.getElementById('zone-weekly').classList.add('loaded');
    } else {
      statusEl.textContent = `✗ ${data.error}`;
      statusEl.className = 'upload-status error';
    }
    refreshStatus();
  } catch (e) {
    statusEl.textContent = `✗ Upload failed`;
    statusEl.className = 'upload-status error';
  }
}

async function uploadDaily(input) {
  if (!input.files.length) return;
  const formData = new FormData();
  for (const f of input.files) formData.append('files', f);
  
  const statusEl = document.getElementById('daily-status');
  statusEl.textContent = 'Processing...';
  statusEl.className = 'upload-status';

  try {
    const res = await fetch(`${API}/api/upload/daily`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      const total = data.results.reduce((s, r) => s + r.recordCount, 0);
      statusEl.textContent = `✓ ${total} records from ${data.results.length} files`;
      statusEl.className = 'upload-status success';
      document.getElementById('zone-daily').classList.add('loaded');
    } else {
      statusEl.textContent = `✗ ${data.error}`;
      statusEl.className = 'upload-status error';
    }
    refreshStatus();
  } catch (e) {
    statusEl.textContent = `✗ Upload failed`;
    statusEl.className = 'upload-status error';
  }
}

async function runQC() {
  const btn = document.getElementById('btn-qc');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running...';
  
  try {
    const res = await fetch(`${API}/api/qc`, { method: 'POST' });
    const data = await res.json();
    if (data.success) renderQCResults(data.qcResults);
    else alert(data.error);
    refreshStatus();
  } catch (e) { alert('QC failed: ' + e.message); }
  
  btn.disabled = false;
  btn.textContent = 'Run QC';
}

async function runReconcile() {
  const btn = document.getElementById('btn-reconcile');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Reconciling...';
  
  try {
    const res = await fetch(`${API}/api/reconcile`, { method: 'POST' });
    const data = await res.json();
    if (data.success) renderReconciliation(data.results);
    else alert(data.error);
    refreshStatus();
  } catch (e) { alert('Reconciliation failed: ' + e.message); }
  
  btn.disabled = false;
  btn.textContent = 'Reconcile';
}

async function generateInvoice() {
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';
  
  const body = {
    invoiceNumber: document.getElementById('inv-number').value || undefined,
    weekEnding: document.getElementById('inv-week-ending').value || undefined,
    invoiceDate: document.getElementById('inv-date').value || undefined,
  };
  
  try {
    const res = await fetch(`${API}/api/generate-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      renderInvoiceResult(data.invoicePackage);
      loadFiles();
    } else alert(data.error);
    refreshStatus();
  } catch (e) { alert('Generation failed: ' + e.message); }
  
  btn.disabled = false;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Generate Invoice Package';
}

async function resetSession() {
  if (!confirm('Reset current session? All loaded data will be cleared.')) return;
  await fetch(`${API}/api/reset`, { method: 'POST' });
  location.reload();
}

async function loadRates() {
  try {
    const res = await fetch(`${API}/api/rates`);
    const rates = await res.json();
    let html = '<table><thead><tr><th>Job Type</th><th>Rate</th></tr></thead><tbody>';
    for (const [type, rate] of Object.entries(rates)) {
      html += `<tr><td>${type}</td><td>$${rate}</td></tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('rates-table').innerHTML = html;
  } catch (e) { console.error(e); }
}

function loadContacts() {
  const contacts = [
    { initials: 'MP', name: 'Mike Presler', email: 'michael.presler@everfastfiber.com' },
    { initials: 'MM', name: 'Marcus Martin', email: 'marcus@caregenalliance.com' },
    { initials: 'KC', name: 'Kevin Crossley', email: 'kevin.crossley@everfastfiber.com' },
    { initials: 'SM', name: 'Shaun Muhammad', email: 'shaun@caregenalliance.com' },
  ];
  let html = '';
  for (const c of contacts) {
    html += `<div class="contact-item">
      <div class="contact-avatar">${c.initials}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name}</div>
        <div class="contact-email">${c.email}</div>
      </div>
    </div>`;
  }
  document.getElementById('contacts-body').innerHTML = html;
}

async function loadFiles() {
  try {
    const res = await fetch(`${API}/api/output-files`);
    const data = await res.json();
    if (!data.files.length) {
      document.getElementById('files-body').innerHTML = '<div class="empty-state-sm">No files generated yet</div>';
      return;
    }
    let html = '';
    for (const f of data.files) {
      const icon = f.name.endsWith('.pdf') ? '📄' : '📊';
      const size = (f.size / 1024).toFixed(1) + ' KB';
      html += `<a href="${f.downloadLink}" class="file-item" download>
        <span class="file-icon">${icon}</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${size}</span>
      </a>`;
    }
    document.getElementById('files-body').innerHTML = html;
  } catch (e) { console.error(e); }
}

function toggleRates() {
  const body = document.getElementById('rates-body');
  body.classList.toggle('hidden');
}

// ============================================================
// UI UPDATES
// ============================================================
function updateUI(data) {
  // Status badge
  const badge = document.getElementById('session-status');
  const statusText = badge.querySelector('.status-text');
  const statusMap = {
    idle: ['Idle', ''],
    data_loaded: ['Data Loaded', 'active'],
    qc_complete: ['QC Complete', 'active'],
    reconciled: ['Reconciled', 'active'],
    invoice_ready: ['Invoice Ready', 'active'],
  };
  const [text, cls] = statusMap[data.status] || ['Unknown', ''];
  statusText.textContent = text;
  badge.className = 'status-badge ' + cls;

  // Pipeline steps
  const steps = ['upload', 'qc', 'reconcile', 'invoice', 'send'];
  const stepIndex = { idle: 0, data_loaded: 1, qc_complete: 2, reconciled: 3, invoice_ready: 4 };
  const currentIdx = stepIndex[data.status] || 0;
  steps.forEach((s, i) => {
    const el = document.getElementById(`step-${s}`);
    el.className = 'pipeline-step' + (i === currentIdx ? ' active' : i < currentIdx ? ' complete' : '');
  });

  // Stats
  if (data.qcResults) {
    document.getElementById('stat-records').textContent = data.qcResults.totalRecords;
  }
  document.getElementById('stat-next-inv').textContent = '#' + data.nextInvoiceNumber;
  if (!document.getElementById('inv-number').value) {
    document.getElementById('inv-number').placeholder = data.nextInvoiceNumber;
  }

  // Upload count
  const uploadCount = data.dailyReportsCount + (data.weeklyDataset ? 1 : 0);
  document.getElementById('upload-count').textContent = uploadCount + ' files';

  // Logs
  if (data.logs && data.logs.length) renderLogs(data.logs);

  // If QC has summary data
  if (data.qcResults && data.qcResults.totalRecords) {
    const summary = state.qcResults;
    if (summary) {
      document.getElementById('stat-total').textContent = '$' + (summary.summary?.grandTotal || 0).toLocaleString();
      document.getElementById('stat-techs').textContent = summary.summary?.uniqueTechs || '—';
    }
  }
}

function renderLogs(logs) {
  const container = document.getElementById('log-entries');
  let html = '';
  for (const log of logs.slice(-20).reverse()) {
    const time = new Date(log.timestamp).toLocaleTimeString();
    html += `<div class="log-entry ${log.type}">
      <span class="log-time">${time}</span>
      <span class="log-msg">${log.message}</span>
    </div>`;
  }
  container.innerHTML = html || '<div class="empty-state-sm">No activity yet</div>';
}

function renderQCResults(qc) {
  const body = document.getElementById('qc-body');
  const statusColor = qc.overallStatus === 'PASSED' ? 'var(--success)' : 
                       qc.overallStatus === 'PASSED_WITH_WARNINGS' ? 'var(--warning)' : 'var(--error)';
  
  let html = `<div class="qc-summary">
    <div class="qc-stat"><span class="qc-stat-value" style="color:${statusColor}">${qc.overallStatus.replace(/_/g,' ')}</span><span class="qc-stat-label">Status</span></div>
    <div class="qc-stat"><span class="qc-stat-value" style="color:var(--success)">${qc.passedRecords}</span><span class="qc-stat-label">Passed</span></div>
    <div class="qc-stat"><span class="qc-stat-value" style="color:var(--warning)">${qc.warnings}</span><span class="qc-stat-label">Warnings</span></div>
    <div class="qc-stat"><span class="qc-stat-value" style="color:var(--error)">${qc.errors}</span><span class="qc-stat-label">Errors</span></div>
  </div>`;

  // Technician breakdown
  if (qc.summary && qc.summary.techTotals) {
    html += '<div class="tech-breakdown"><h4 style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Technician Breakdown</h4>';
    for (const [tech, total] of Object.entries(qc.summary.techTotals).sort((a,b) => b[1]-a[1])) {
      html += `<div class="tech-row"><span>${tech}</span><span class="tech-amount">$${total.toLocaleString()}</span></div>`;
    }
    html += `<div class="tech-row" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">
      <span>Grand Total</span><span class="tech-amount">$${qc.summary.grandTotal.toLocaleString()}</span></div>`;
    html += '</div>';
  }

  // Issues (show first 20)
  if (qc.issues && qc.issues.length) {
    html += `<div style="margin-top:16px"><h4 style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Issues (${qc.issues.length})</h4><div class="qc-issues">`;
    for (const issue of qc.issues.slice(0, 20)) {
      html += `<div class="qc-issue ${issue.severity}">
        <strong>${issue.workOrderNumber || 'N/A'}</strong> — ${issue.type.replace(/_/g,' ')}: ${issue.field}
        ${issue.expected !== undefined ? ` (expected $${issue.expected}, got $${issue.actual})` : ''}
        ${issue.value !== undefined ? ` = ${issue.value}` : ''}
      </div>`;
    }
    if (qc.issues.length > 20) html += `<div class="empty-state-sm">...and ${qc.issues.length - 20} more</div>`;
    html += '</div></div>';
  }

  // Update stats
  document.getElementById('stat-records').textContent = qc.totalRecords;
  if (qc.summary) {
    document.getElementById('stat-total').textContent = '$' + qc.summary.grandTotal.toLocaleString();
    document.getElementById('stat-techs').textContent = qc.summary.uniqueTechs;
  }

  body.innerHTML = html;
}

function renderReconciliation(results) {
  const body = document.getElementById('reconcile-body');
  const status = results.reconciled ? 'RECONCILED' : 'DISCREPANCIES FOUND';
  const statusCls = results.reconciled ? 'good' : 'bad';

  let html = `<div class="recon-summary">
    <div class="recon-stat ${statusCls}"><span class="recon-value">${results.matched.length}</span><span class="recon-label">Matched</span></div>
    <div class="recon-stat ${results.missingInWeekly.length ? 'bad' : 'good'}"><span class="recon-value">${results.missingInWeekly.length}</span><span class="recon-label">Missing in Weekly</span></div>
    <div class="recon-stat ${results.amountDiscrepancies.length ? 'bad' : 'good'}"><span class="recon-value">${results.amountDiscrepancies.length}</span><span class="recon-label">Amount Issues</span></div>
  </div>`;

  html += `<div style="text-align:center;margin-bottom:16px;">
    <span class="badge ${statusCls === 'good' ? 'badge-success' : 'badge-error'}" style="font-size:13px;padding:6px 16px;">${status}</span>
    <div style="margin-top:8px;font-size:12px;color:var(--text-tertiary);">
      Daily Total: $${results.totalDailyAmount.toLocaleString()} | Weekly Total: $${results.totalWeeklyAmount.toLocaleString()}
    </div>
  </div>`;

  if (results.amountDiscrepancies.length) {
    html += '<h4 style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Amount Discrepancies</h4>';
    for (const d of results.amountDiscrepancies.slice(0, 15)) {
      html += `<div class="qc-issue warning">
        <strong>${d.workOrderNumber}</strong> — Daily: $${d.dailyTotal} vs Weekly: $${d.weeklyTotal} (diff: $${d.difference})
      </div>`;
    }
  }

  if (results.missingInWeekly.length) {
    html += `<h4 style="font-size:12px;color:var(--text-secondary);margin:12px 0 8px;">Missing from Weekly Dataset (${results.missingInWeekly.length})</h4>`;
    for (const r of results.missingInWeekly.slice(0, 10)) {
      html += `<div class="qc-issue error"><strong>${r.workOrderNumber}</strong> — ${r.techName} — $${r.total}</div>`;
    }
  }

  body.innerHTML = html;
}

function renderInvoiceResult(pkg) {
  const container = document.getElementById('invoice-results');
  container.classList.remove('hidden');
  container.innerHTML = `<div class="invoice-result">
    <h3>Invoice #${pkg.invoiceNumber} Generated ✓</h3>
    <p style="color:var(--text-secondary);font-size:13px;">Week Ending: ${pkg.weekEnding} • ${pkg.recordCount} work orders</p>
    <div class="invoice-total">$${pkg.grandTotal.toLocaleString()}</div>
    <div class="invoice-downloads">
      <a href="${pkg.downloadLinks.excel}" class="btn btn-primary" download>📊 Download Dataset</a>
      <a href="${pkg.downloadLinks.pdf}" class="btn btn-secondary" download>📄 Download Invoice PDF</a>
    </div>
    <p style="margin-top:12px;font-size:11px;color:var(--text-tertiary);">
      Archived to invoice history • Ready to send to Kevin & Mike
    </p>
  </div>`;

  // Refresh invoice history
  loadInvoiceHistory();
}

// ============================================================
// INVOICE HISTORY
// ============================================================
async function loadInvoiceHistory() {
  try {
    const res = await fetch(`${API}/api/invoices`);
    const data = await res.json();
    const container = document.getElementById('history-body');
    const badge = document.getElementById('history-count');

    if (!data.invoices || data.invoices.length === 0) {
      container.innerHTML = '<div class="empty-state-sm">No invoices generated yet. Upload a dataset and generate your first invoice.</div>';
      badge.textContent = '0';
      return;
    }

    badge.textContent = data.invoices.length + ' invoices';

    let html = `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);">
            <th style="text-align:left;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Invoice #</th>
            <th style="text-align:left;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Week Ending</th>
            <th style="text-align:left;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Date</th>
            <th style="text-align:right;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Orders</th>
            <th style="text-align:right;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
            <th style="text-align:center;padding:10px 12px;color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Downloads</th>
          </tr>
        </thead>
        <tbody>`;

    for (const inv of data.invoices) {
      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:10px 12px;font-weight:600;color:var(--accent);">#${inv.invoiceNumber}</td>
        <td style="padding:10px 12px;">${inv.weekEnding || '—'}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);">${inv.invoiceDate || '—'}</td>
        <td style="padding:10px 12px;text-align:right;">${inv.recordCount}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:var(--success);">$${(inv.grandTotal || 0).toLocaleString()}</td>
        <td style="padding:10px 12px;text-align:center;">
          ${inv.downloadLinks.excel ? `<a href="${inv.downloadLinks.excel}" class="btn btn-ghost btn-sm" download title="Download Excel Dataset">📊</a>` : ''}
          ${inv.downloadLinks.pdf ? `<a href="${inv.downloadLinks.pdf}" class="btn btn-ghost btn-sm" download title="Download Invoice PDF">📄</a>` : ''}
        </td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

  } catch (e) {
    console.error('Failed to load invoice history:', e);
    document.getElementById('history-body').innerHTML = '<div class="empty-state-sm">Could not load invoice history</div>';
  }
}


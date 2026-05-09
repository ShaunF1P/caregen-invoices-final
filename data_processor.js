/**
 * CareGen Alliance Invoice Automation - Data Processor
 * Handles reading, validating, and processing work order data from Excel files
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class DataProcessor {
  constructor() {
    this.rates = config.rates;
    this.ensureDirectories();
  }

  ensureDirectories() {
    [config.paths.dataDir, config.paths.uploadsDir, config.paths.outputDir, config.paths.archiveDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  /**
   * Parse a daily work report Excel file from Mike
   * Expected format: Work Order Date, Work Order Number, Tech Name, Base Work Order Type, 
   *                  Additional Work (x2), Base Work Order $, Additional (1) $, Additional (2) $, Total
   */
  parseDailyReport(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    // Find the header row (look for "Work Order" in first column)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      if (row && row[0] && String(row[0]).toLowerCase().includes('work order')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Try alternative: first row with data that has multiple columns
      for (let i = 0; i < Math.min(15, rawData.length); i++) {
        const row = rawData[i];
        if (row && row.length >= 6) {
          headerRowIdx = i;
          break;
        }
      }
    }

    if (headerRowIdx === -1) {
      throw new Error(`Could not find header row in file: ${path.basename(filePath)}`);
    }

    const headers = rawData[headerRowIdx].map(h => String(h || '').trim());
    const records = [];

    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length < 3) continue;
      
      // Skip empty rows or total rows
      const firstCell = String(row[0] || '').trim();
      if (!firstCell || firstCell.toLowerCase().includes('total') || firstCell.toLowerCase().includes('grand')) continue;

      const record = this._mapRowToRecord(row, headers);
      if (record && record.workOrderNumber) {
        records.push(record);
      }
    }

    return {
      fileName: path.basename(filePath),
      headers,
      records,
      recordCount: records.length,
      parsedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse Marcus's compiled weekly dataset
   */
  parseWeeklyDataset(filePath) {
    const wb = XLSX.readFile(filePath);
    const allRecords = [];
    const sheetResults = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
      
      // Extract metadata from header rows
      const metadata = this._extractInvoiceMetadata(rawData);
      
      // Find data header row
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(15, rawData.length); i++) {
        const row = rawData[i];
        if (row && row[0] && String(row[0]).toLowerCase().includes('work order')) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx === -1) continue;

      const headers = rawData[headerRowIdx].map(h => String(h || '').trim());
      const records = [];

      for (let i = headerRowIdx + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 3) continue;
        const firstCell = String(row[0] || '').trim();
        if (!firstCell || firstCell.toLowerCase().includes('total') || firstCell.toLowerCase().includes('grand')) continue;

        const record = this._mapRowToRecord(row, headers);
        if (record && record.workOrderNumber) {
          records.push(record);
        }
      }

      sheetResults.push({
        sheetName,
        metadata,
        records,
        recordCount: records.length,
      });

      allRecords.push(...records);
    }

    return {
      fileName: path.basename(filePath),
      sheets: sheetResults,
      totalRecords: allRecords.length,
      allRecords,
      parsedAt: new Date().toISOString(),
    };
  }

  /**
   * Map a raw row array to a structured work order record
   */
  _mapRowToRecord(row, headers) {
    const record = {};
    
    // Normalize headers and map
    const headerMap = {
      'Work Order Date': ['work order date', 'date', 'wo date'],
      'Work Order Number': ['work order number', 'wo number', 'wo#', 'service order', 'work order #'],
      'Tech Name': ['tech name', 'tech', 'technician', 'technician name'],
      'Base Work Order Type': ['base work order type', 'work order type', 'wo type', 'type', 'base work order'],
      'Additional Work 1': ['additional work performed (not on order)', 'additional work 1', 'additional (1)'],
      'Additional Work 2': ['additional work performed (not on order)', 'additional work 2', 'additional (2)'],
    };

    // Try to find columns by header matching
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const header = (headers[colIdx] || '').toLowerCase().trim();
      
      if (header.includes('work order date') || header === 'date') {
        record.workOrderDate = this._parseDate(row[colIdx]);
      } else if (header.includes('work order number') || header.includes('wo#') || header.includes('service order')) {
        record.workOrderNumber = String(row[colIdx] || '').trim();
      } else if (header.includes('tech name') || header === 'tech' || header.includes('technician')) {
        record.techName = String(row[colIdx] || '').trim();
      } else if (header.includes('base work order type') || (header === 'type' && colIdx < 5)) {
        record.baseWorkOrderType = String(row[colIdx] || '').trim().toUpperCase();
      } else if (header.includes('additional work') && !record.additionalWork1) {
        record.additionalWork1 = String(row[colIdx] || '').trim().toUpperCase() || null;
      } else if (header.includes('additional work') && record.additionalWork1) {
        record.additionalWork2 = String(row[colIdx] || '').trim().toUpperCase() || null;
      } else if (header.includes('base work order') && !header.includes('type') && colIdx >= 5) {
        record.baseWorkOrderAmount = this._parseAmount(row[colIdx]);
      } else if (header.includes('additional (1)') || header.includes('additional 1')) {
        record.additionalAmount1 = this._parseAmount(row[colIdx]);
      } else if (header.includes('additional (2)') || header.includes('additional 2')) {
        record.additionalAmount2 = this._parseAmount(row[colIdx]);
      } else if (header === 'total') {
        record.total = this._parseAmount(row[colIdx]);
      }
    }

    // Fallback: positional mapping if header matching didn't work well
    if (!record.workOrderNumber && row.length >= 10) {
      record.workOrderDate = this._parseDate(row[0]);
      record.workOrderNumber = String(row[1] || '').trim();
      record.techName = String(row[2] || '').trim();
      record.baseWorkOrderType = String(row[3] || '').trim().toUpperCase();
      record.additionalWork1 = String(row[4] || '').trim().toUpperCase() || null;
      record.additionalWork2 = String(row[5] || '').trim().toUpperCase() || null;
      record.baseWorkOrderAmount = this._parseAmount(row[6]);
      record.additionalAmount1 = this._parseAmount(row[7]);
      record.additionalAmount2 = this._parseAmount(row[8]);
      record.total = this._parseAmount(row[9]);
    }

    return record;
  }

  /**
   * Extract invoice metadata from header rows of a dataset sheet
   */
  _extractInvoiceMetadata(rawData) {
    const meta = {};
    for (let i = 0; i < Math.min(8, rawData.length); i++) {
      const row = rawData[i];
      if (!row) continue;
      for (let j = 0; j < row.length; j++) {
        const val = String(row[j] || '').trim().toLowerCase();
        if (val.includes('invoice date') && row[j + 1]) {
          meta.invoiceDate = this._parseDate(row[j + 1]);
        }
        if (val.includes('week ending') && row[j + 1]) {
          meta.weekEnding = this._parseDate(row[j + 1]);
        }
        if (val.includes('invoice #') && row[j + 1]) {
          meta.invoiceNumber = parseInt(row[j + 1]) || row[j + 1];
        }
        if (val.includes('type:') && row[j + 1]) {
          meta.type = String(row[j + 1]).trim();
        }
        if (val.includes('po number') && row[j + 1]) {
          meta.poNumber = String(row[j + 1]).trim();
        }
        if (val.includes('total') && row[j + 1]) {
          meta.grandTotal = this._parseAmount(row[j + 1]);
        }
      }
    }
    return meta;
  }

  /**
   * Parse Excel date value (serial number or string)
   */
  _parseDate(val) {
    if (!val) return null;
    
    // If it's an Excel serial date number
    if (typeof val === 'number' && val > 40000 && val < 60000) {
      const date = new Date((val - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    
    // If it's already a Date
    if (val instanceof Date) {
      return val.toISOString().split('T')[0];
    }
    
    // Try parsing as string
    const str = String(val).trim();
    const datePatterns = [
      /^(\w{3})\s+(\d{1,2}),?\s+(\d{4})$/,  // "Jul 5, 2022"
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,     // "7/5/2022"
      /^(\d{4})-(\d{2})-(\d{2})$/,              // "2022-07-05"
      /^(\d{2})\.(\d{2})\.(\d{2,4})$/,          // "05.05.26"
    ];

    for (const pattern of datePatterns) {
      const match = str.match(pattern);
      if (match) {
        try {
          const parsed = new Date(str);
          if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
          }
        } catch (e) { /* continue */ }
      }
    }
    
    // Last resort
    try {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    } catch (e) { /* continue */ }
    
    return str;
  }

  /**
   * Parse dollar amount
   */
  _parseAmount(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/[$,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Validate a work order record against the rate card
   */
  validateRecord(record) {
    const issues = [];
    
    // Check required fields
    for (const field of config.qc.requiredFields) {
      const key = field.replace(/\s+/g, '');
      const camelKey = field.charAt(0).toLowerCase() + field.slice(1).replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
      if (!record[camelKey] && !record[key]) {
        issues.push({ type: 'missing_field', field, severity: 'error' });
      }
    }

    // Validate base work order type against rate card
    if (record.baseWorkOrderType) {
      const rateKey = this._findRateKey(record.baseWorkOrderType);
      if (rateKey) {
        const expectedRate = this.rates[rateKey];
        if (record.baseWorkOrderAmount && record.baseWorkOrderAmount !== expectedRate) {
          issues.push({
            type: 'rate_mismatch',
            field: 'Base Work Order Amount',
            expected: expectedRate,
            actual: record.baseWorkOrderAmount,
            workOrderType: record.baseWorkOrderType,
            severity: 'warning',
          });
        }
      } else {
        issues.push({
          type: 'unknown_work_type',
          field: 'Base Work Order Type',
          value: record.baseWorkOrderType,
          severity: 'warning',
        });
      }
    }

    // Validate additional work amounts
    if (record.additionalWork1) {
      const rateKey = this._findRateKey(record.additionalWork1);
      if (rateKey) {
        const expectedRate = this.rates[rateKey];
        if (record.additionalAmount1 && record.additionalAmount1 !== expectedRate) {
          issues.push({
            type: 'rate_mismatch',
            field: 'Additional (1)',
            expected: expectedRate,
            actual: record.additionalAmount1,
            workOrderType: record.additionalWork1,
            severity: 'warning',
          });
        }
      }
    }

    if (record.additionalWork2) {
      const rateKey = this._findRateKey(record.additionalWork2);
      if (rateKey) {
        const expectedRate = this.rates[rateKey];
        if (record.additionalAmount2 && record.additionalAmount2 !== expectedRate) {
          issues.push({
            type: 'rate_mismatch',
            field: 'Additional (2)',
            expected: expectedRate,
            actual: record.additionalAmount2,
            workOrderType: record.additionalWork2,
            severity: 'warning',
          });
        }
      }
    }

    // Validate total calculation
    const expectedTotal = (record.baseWorkOrderAmount || 0) + (record.additionalAmount1 || 0) + (record.additionalAmount2 || 0);
    if (record.total && Math.abs(record.total - expectedTotal) > 0.01) {
      issues.push({
        type: 'total_mismatch',
        field: 'Total',
        expected: expectedTotal,
        actual: record.total,
        severity: 'error',
      });
    }

    // Flag unusually high totals
    if (record.total > config.qc.maxOrderTotal) {
      issues.push({
        type: 'high_total',
        field: 'Total',
        value: record.total,
        threshold: config.qc.maxOrderTotal,
        severity: 'warning',
      });
    }

    return issues;
  }

  /**
   * Find the rate card key matching a work type string
   */
  _findRateKey(workType) {
    if (!workType) return null;
    const normalized = workType.toUpperCase().trim();
    
    // Direct match
    if (this.rates[normalized]) return normalized;
    
    // Fuzzy match
    for (const key of Object.keys(this.rates)) {
      if (normalized.includes(key) || key.includes(normalized)) return key;
    }
    
    return null;
  }

  /**
   * Run full QC on a dataset
   */
  runQC(records) {
    const results = {
      totalRecords: records.length,
      passedRecords: 0,
      failedRecords: 0,
      warnings: 0,
      errors: 0,
      issues: [],
      duplicates: [],
      summary: {},
      recordResults: [],
    };

    // Check for duplicates
    const woNumbers = {};
    for (const record of records) {
      const woNum = record.workOrderNumber;
      if (woNumbers[woNum]) {
        woNumbers[woNum].push(record);
        results.duplicates.push({
          workOrderNumber: woNum,
          occurrences: woNumbers[woNum].length + 1,
          records: woNumbers[woNum],
        });
      } else {
        woNumbers[woNum] = [record];
      }
    }

    // Validate each record
    for (const record of records) {
      const recordIssues = this.validateRecord(record);
      const hasErrors = recordIssues.some(i => i.severity === 'error');
      const hasWarnings = recordIssues.some(i => i.severity === 'warning');

      results.recordResults.push({
        record,
        issues: recordIssues,
        status: hasErrors ? 'FAIL' : hasWarnings ? 'WARN' : 'PASS',
      });

      if (hasErrors) {
        results.failedRecords++;
        results.errors += recordIssues.filter(i => i.severity === 'error').length;
      } else {
        results.passedRecords++;
      }
      results.warnings += recordIssues.filter(i => i.severity === 'warning').length;
      results.issues.push(...recordIssues.map(issue => ({ ...issue, workOrderNumber: record.workOrderNumber })));
    }

    // Summary statistics
    const techTotals = {};
    const typeTotals = {};
    let grandTotal = 0;

    for (const record of records) {
      const tech = record.techName || 'Unknown';
      const type = record.baseWorkOrderType || 'Unknown';
      const total = record.total || 0;

      techTotals[tech] = (techTotals[tech] || 0) + total;
      typeTotals[type] = (typeTotals[type] || 0) + total;
      grandTotal += total;
    }

    results.summary = {
      grandTotal,
      techTotals,
      typeTotals,
      dateRange: this._getDateRange(records),
      uniqueTechs: Object.keys(techTotals).length,
      uniqueWorkTypes: Object.keys(typeTotals).length,
    };

    results.overallStatus = results.failedRecords === 0 ? 
      (results.warnings === 0 ? 'PASSED' : 'PASSED_WITH_WARNINGS') : 'FAILED';

    return results;
  }

  /**
   * Get date range from records
   */
  _getDateRange(records) {
    const dates = records
      .map(r => r.workOrderDate)
      .filter(d => d)
      .sort();
    return {
      start: dates[0] || 'N/A',
      end: dates[dates.length - 1] || 'N/A',
    };
  }

  /**
   * Reconcile daily reports against the weekly compiled dataset
   */
  reconcile(dailyRecords, weeklyRecords) {
    const results = {
      matched: [],
      missingInWeekly: [],
      missingInDaily: [],
      amountDiscrepancies: [],
      totalDailyAmount: 0,
      totalWeeklyAmount: 0,
    };

    const dailyMap = new Map();
    for (const rec of dailyRecords) {
      dailyMap.set(rec.workOrderNumber, rec);
      results.totalDailyAmount += rec.total || 0;
    }

    const weeklyMap = new Map();
    for (const rec of weeklyRecords) {
      weeklyMap.set(rec.workOrderNumber, rec);
      results.totalWeeklyAmount += rec.total || 0;
    }

    // Find matches and discrepancies
    for (const [woNum, dailyRec] of dailyMap) {
      const weeklyRec = weeklyMap.get(woNum);
      if (!weeklyRec) {
        results.missingInWeekly.push(dailyRec);
      } else {
        if (Math.abs((dailyRec.total || 0) - (weeklyRec.total || 0)) > 0.01) {
          results.amountDiscrepancies.push({
            workOrderNumber: woNum,
            dailyTotal: dailyRec.total,
            weeklyTotal: weeklyRec.total,
            difference: (dailyRec.total || 0) - (weeklyRec.total || 0),
          });
        } else {
          results.matched.push(woNum);
        }
      }
    }

    // Find records in weekly but not in daily
    for (const [woNum, weeklyRec] of weeklyMap) {
      if (!dailyMap.has(woNum)) {
        results.missingInDaily.push(weeklyRec);
      }
    }

    results.reconciled = results.missingInWeekly.length === 0 && 
                          results.missingInDaily.length === 0 && 
                          results.amountDiscrepancies.length === 0;

    return results;
  }
}

module.exports = DataProcessor;

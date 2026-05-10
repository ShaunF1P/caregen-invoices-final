/**
 * CareGen Alliance Invoice Automation - Analytics Engine
 * Revenue intelligence, trend analysis, missing money detection,
 * week-over-week and year-over-year comparisons
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

class AnalyticsEngine {
  constructor() {
    this.historicalData = null;
    this.loadHistoricalData();
  }

  loadHistoricalData() {
    const filePath = path.join(config.paths.dataDir, 'historical_data.json');
    if (fs.existsSync(filePath)) {
      this.historicalData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      this.historicalData = { invoices: [], records: [], gaps: [] };
    }
  }

  /**
   * Classify an invoice into its revenue stream
   * - 'everfast': Everfast weekly service invoices (the main operational stream)
   * - 'amt': CareGen Group / Advanced Media Technologies project invoices
   * - 'other': Unclassified
   */
  _classifyInvoice(inv) {
    if (inv.type === 'AMT/CareGen Group' || inv.billTo === 'Advanced Media Technologies') {
      return 'amt';
    }
    if (inv.source && inv.source.includes('Current Invoices') && inv.invoiceNumber <= 76) {
      return 'amt';
    }
    return 'everfast';
  }

  /**
   * Get only the Everfast weekly invoices (main operational stream)
   */
  _getEverfastInvoices(invoices) {
    return invoices.filter(i => this._classifyInvoice(i) === 'everfast');
  }

  /**
   * Get full analytics dashboard data
   */
  getAnalytics() {
    // Reload historical data fresh each time to pick up changes
    this.loadHistoricalData();
    
    const allInvoices = this.historicalData.invoices || [];
    if (allInvoices.length === 0) return { error: 'No historical data loaded' };

    // Separate the two revenue streams
    const everfastInvoices = this._getEverfastInvoices(allInvoices);
    const amtInvoices = allInvoices.filter(i => this._classifyInvoice(i) === 'amt');

    return {
      overview: this._getOverview(allInvoices, everfastInvoices, amtInvoices),
      weeklyTrend: this._getWeeklyTrend(everfastInvoices),
      monthlyTrend: this._getMonthlyTrend(everfastInvoices),
      missingMoney: this._detectMissingMoney(everfastInvoices),
      weekComparison: this._getWeekComparison(everfastInvoices),
      yearOverYear: this._getYearOverYear(everfastInvoices),
      techPerformance: this._getTechPerformance(),
      seasonality: this._getSeasonality(everfastInvoices),
      invoiceGaps: this.historicalData.gaps || [],
      revenueStreams: {
        everfast: {
          count: everfastInvoices.length,
          total: everfastInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0),
        },
        amt: {
          count: amtInvoices.length,
          total: amtInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0),
        },
      },
    };
  }

  /**
   * High-level overview stats
   */
  _getOverview(allInvoices, everfastInvoices, amtInvoices) {
    // Use Everfast invoices for operational metrics (weekly averages, WOs, etc.)
    const efTotals = everfastInvoices.map(i => i.grandTotal || 0).filter(t => t > 0);
    const efWOCounts = everfastInvoices.map(i => i.workOrderCount || 0).filter(c => c > 0);
    const efTotalRevenue = efTotals.reduce((s, t) => s + t, 0);
    const amtTotalRevenue = amtInvoices.reduce((s, i) => s + (i.grandTotal || 0), 0);
    const combinedRevenue = efTotalRevenue + amtTotalRevenue;

    return {
      totalInvoices: allInvoices.length,
      totalRevenue: combinedRevenue,
      everfastRevenue: efTotalRevenue,
      amtRevenue: amtTotalRevenue,
      everfastCount: everfastInvoices.length,
      amtCount: amtInvoices.length,
      avgWeeklyRevenue: efTotals.length ? Math.round(efTotalRevenue / efTotals.length) : 0,
      medianWeeklyRevenue: this._median(efTotals),
      avgWorkOrdersPerWeek: efWOCounts.length ? Math.round(efWOCounts.reduce((s, c) => s + c, 0) / efWOCounts.length) : 0,
      avgRevenuePerWorkOrder: efWOCounts.length ? Math.round(efTotalRevenue / efWOCounts.reduce((s, c) => s + c, 0)) : 0,
      highestWeek: efTotals.length ? { amount: Math.max(...efTotals) } : { amount: 0 },
      lowestWeek: efTotals.length ? { amount: Math.min(...efTotals) } : { amount: 0 },
      last4WeekAvg: this._recentAverage(everfastInvoices, 4),
      last12WeekAvg: this._recentAverage(everfastInvoices, 12),
    };
  }

  /**
   * Weekly trend data for charting
   */
  _getWeeklyTrend(invoices) {
    return invoices
      .filter(i => i.weekEndingDate && i.grandTotal)
      .sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''))
      .map(i => ({
        week: i.weekEndingDate,
        invoiceNumber: i.invoiceNumber,
        revenue: i.grandTotal,
        workOrders: i.workOrderCount,
        revenuePerWO: i.workOrderCount ? Math.round(i.grandTotal / i.workOrderCount) : 0,
      }));
  }

  /**
   * Monthly aggregated trend
   */
  _getMonthlyTrend(invoices) {
    const monthMap = {};
    for (const inv of invoices) {
      if (!inv.weekEndingDate || !inv.grandTotal) continue;
      const month = inv.weekEndingDate.substring(0, 7); // YYYY-MM
      if (!monthMap[month]) monthMap[month] = { revenue: 0, workOrders: 0, invoiceCount: 0 };
      monthMap[month].revenue += inv.grandTotal;
      monthMap[month].workOrders += inv.workOrderCount || 0;
      monthMap[month].invoiceCount++;
    }

    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        ...data,
        avgWeeklyRevenue: Math.round(data.revenue / data.invoiceCount),
      }));
  }

  /**
   * MISSING MONEY DETECTION
   * Identifies anomalies where revenue is significantly below expected
   */
  _detectMissingMoney(invoices) {
    const sorted = invoices
      .filter(i => i.weekEndingDate && i.grandTotal > 0)
      .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate));

    const alerts = [];

    // Calculate rolling averages
    for (let i = 0; i < sorted.length; i++) {
      const inv = sorted[i];
      
      // Compare against 8-week rolling average
      const windowStart = Math.max(0, i - 8);
      const window = sorted.slice(windowStart, i);
      if (window.length < 3) continue;

      const rollingAvg = window.reduce((s, w) => s + w.grandTotal, 0) / window.length;
      const rollingAvgWO = window.reduce((s, w) => s + (w.workOrderCount || 0), 0) / window.length;
      const deviation = ((inv.grandTotal - rollingAvg) / rollingAvg) * 100;
      const woDeviation = inv.workOrderCount ? ((inv.workOrderCount - rollingAvgWO) / rollingAvgWO) * 100 : 0;

      // Flag if revenue drops more than 30% below rolling average
      if (deviation < -30) {
        const potentialMissing = Math.round(rollingAvg - inv.grandTotal);
        alerts.push({
          type: 'revenue_drop',
          severity: deviation < -50 ? 'high' : 'medium',
          invoiceNumber: inv.invoiceNumber,
          week: inv.weekEndingDate,
          actual: inv.grandTotal,
          expected: Math.round(rollingAvg),
          deviation: Math.round(deviation),
          potentialMissing,
          workOrderDrop: Math.round(woDeviation),
          message: `Inv #${inv.invoiceNumber} (${inv.weekEndingDate}): $${inv.grandTotal.toLocaleString()} is ${Math.abs(Math.round(deviation))}% below the 8-week average of $${Math.round(rollingAvg).toLocaleString()}. Potential missing: $${potentialMissing.toLocaleString()}`,
        });
      }

      // Flag if work orders drop significantly but revenue per WO stays same (missing WOs)
      if (woDeviation < -25 && deviation < -15) {
        alerts.push({
          type: 'work_order_drop',
          severity: woDeviation < -40 ? 'high' : 'medium',
          invoiceNumber: inv.invoiceNumber,
          week: inv.weekEndingDate,
          actualWOs: inv.workOrderCount,
          expectedWOs: Math.round(rollingAvgWO),
          woDeviation: Math.round(woDeviation),
          message: `Inv #${inv.invoiceNumber}: Only ${inv.workOrderCount} work orders vs avg ${Math.round(rollingAvgWO)} (${Math.abs(Math.round(woDeviation))}% drop). Possible missed work orders.`,
        });
      }

      // Flag if revenue per work order is abnormally low (undercharging)
      if (inv.workOrderCount > 5) {
        const revPerWO = inv.grandTotal / inv.workOrderCount;
        const avgRevPerWO = window.reduce((s, w) => s + (w.workOrderCount ? w.grandTotal / w.workOrderCount : 0), 0) / window.length;
        if (avgRevPerWO > 0 && revPerWO < avgRevPerWO * 0.8) {
          alerts.push({
            type: 'low_revenue_per_wo',
            severity: 'medium',
            invoiceNumber: inv.invoiceNumber,
            week: inv.weekEndingDate,
            actualRevPerWO: Math.round(revPerWO),
            expectedRevPerWO: Math.round(avgRevPerWO),
            message: `Inv #${inv.invoiceNumber}: Revenue per WO is $${Math.round(revPerWO)} vs avg $${Math.round(avgRevPerWO)}. May be missing additional work charges.`,
          });
        }
      }
    }

    // Also check for invoice number gaps as potential missing invoices
    const gaps = this.historicalData.gaps || [];
    if (gaps.length > 0) {
      // Estimate revenue for missing invoice numbers
      const avgRevenue = sorted.reduce((s, i) => s + i.grandTotal, 0) / sorted.length;
      alerts.push({
        type: 'missing_invoices',
        severity: 'high',
        missingNumbers: gaps,
        estimatedLostRevenue: Math.round(avgRevenue * gaps.length),
        message: `${gaps.length} missing invoice numbers detected (${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '...' : ''}). Estimated unrealized revenue: $${Math.round(avgRevenue * gaps.length).toLocaleString()}`,
      });
    }

    // Calculate total potential missing money
    const totalPotentialMissing = alerts
      .filter(a => a.type === 'revenue_drop')
      .reduce((s, a) => s + (a.potentialMissing || 0), 0);

    return {
      alerts: alerts.sort((a, b) => {
        const sevOrder = { high: 0, medium: 1, low: 2 };
        return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
      }),
      totalPotentialMissing,
      alertCount: alerts.length,
      highSeverity: alerts.filter(a => a.severity === 'high').length,
    };
  }

  /**
   * WEEK-OVER-WEEK COMPARISON
   * Compare the current/latest week against the previous week
   */
  _getWeekComparison(invoices) {
    const sorted = invoices
      .filter(i => i.weekEndingDate && i.grandTotal > 0)
      .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate));

    if (sorted.length < 2) return null;

    const current = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];

    const revenueChange = current.grandTotal - previous.grandTotal;
    const revenueChangePct = ((revenueChange / previous.grandTotal) * 100);
    const woChange = (current.workOrderCount || 0) - (previous.workOrderCount || 0);
    const woChangePct = previous.workOrderCount ? ((woChange / previous.workOrderCount) * 100) : 0;

    // Also show last 6 weeks for context
    const recentWeeks = sorted.slice(-6).map(inv => ({
      week: inv.weekEndingDate,
      invoiceNumber: inv.invoiceNumber,
      revenue: inv.grandTotal,
      workOrders: inv.workOrderCount,
    }));

    return {
      current: {
        week: current.weekEndingDate,
        invoiceNumber: current.invoiceNumber,
        revenue: current.grandTotal,
        workOrders: current.workOrderCount,
      },
      previous: {
        week: previous.weekEndingDate,
        invoiceNumber: previous.invoiceNumber,
        revenue: previous.grandTotal,
        workOrders: previous.workOrderCount,
      },
      changes: {
        revenue: revenueChange,
        revenuePct: Math.round(revenueChangePct * 10) / 10,
        workOrders: woChange,
        workOrdersPct: Math.round(woChangePct * 10) / 10,
        direction: revenueChange >= 0 ? 'up' : 'down',
      },
      recentWeeks,
    };
  }

  /**
   * YEAR-OVER-YEAR COMPARISON
   * Compare current period vs same period last year
   */
  _getYearOverYear(invoices) {
    const sorted = invoices
      .filter(i => i.weekEndingDate && i.grandTotal > 0)
      .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate));

    if (sorted.length === 0) return null;

    const latest = sorted[sorted.length - 1];
    const latestDate = new Date(latest.weekEndingDate);
    const latestMonth = latestDate.getMonth();
    const latestYear = latestDate.getFullYear();

    // Find same week last year (± 1 week)
    const targetDate = new Date(latestDate);
    targetDate.setFullYear(targetDate.getFullYear() - 1);
    const targetStr = targetDate.toISOString().split('T')[0];

    let closestLastYear = null;
    let minDiff = Infinity;
    for (const inv of sorted) {
      if (!inv.weekEndingDate) continue;
      const diff = Math.abs(new Date(inv.weekEndingDate).getTime() - targetDate.getTime());
      if (diff < minDiff && diff < 14 * 86400000) { // within 2 weeks
        minDiff = diff;
        closestLastYear = inv;
      }
    }

    // Monthly comparison: current month this year vs same month last year
    const currentMonthInvoices = sorted.filter(i => {
      const d = new Date(i.weekEndingDate);
      return d.getMonth() === latestMonth && d.getFullYear() === latestYear;
    });
    const lastYearMonthInvoices = sorted.filter(i => {
      const d = new Date(i.weekEndingDate);
      return d.getMonth() === latestMonth && d.getFullYear() === latestYear - 1;
    });

    const currentMonthTotal = currentMonthInvoices.reduce((s, i) => s + i.grandTotal, 0);
    const lastYearMonthTotal = lastYearMonthInvoices.reduce((s, i) => s + i.grandTotal, 0);

    // Quarterly comparison
    const currentQtr = Math.floor(latestMonth / 3);
    const currentQtrInvoices = sorted.filter(i => {
      const d = new Date(i.weekEndingDate);
      return Math.floor(d.getMonth() / 3) === currentQtr && d.getFullYear() === latestYear;
    });
    const lastYearQtrInvoices = sorted.filter(i => {
      const d = new Date(i.weekEndingDate);
      return Math.floor(d.getMonth() / 3) === currentQtr && d.getFullYear() === latestYear - 1;
    });

    const currentQtrTotal = currentQtrInvoices.reduce((s, i) => s + i.grandTotal, 0);
    const lastYearQtrTotal = lastYearQtrInvoices.reduce((s, i) => s + i.grandTotal, 0);

    return {
      sameWeekLastYear: closestLastYear ? {
        current: { week: latest.weekEndingDate, revenue: latest.grandTotal, workOrders: latest.workOrderCount },
        lastYear: { week: closestLastYear.weekEndingDate, revenue: closestLastYear.grandTotal, workOrders: closestLastYear.workOrderCount },
        change: latest.grandTotal - closestLastYear.grandTotal,
        changePct: closestLastYear.grandTotal ? Math.round(((latest.grandTotal - closestLastYear.grandTotal) / closestLastYear.grandTotal) * 1000) / 10 : null,
      } : null,
      monthlyComparison: {
        monthName: new Date(latestYear, latestMonth).toLocaleString('default', { month: 'long' }),
        currentYear: { year: latestYear, total: currentMonthTotal, weeks: currentMonthInvoices.length },
        lastYear: { year: latestYear - 1, total: lastYearMonthTotal, weeks: lastYearMonthInvoices.length },
        change: currentMonthTotal - lastYearMonthTotal,
        changePct: lastYearMonthTotal ? Math.round(((currentMonthTotal - lastYearMonthTotal) / lastYearMonthTotal) * 1000) / 10 : null,
      },
      quarterlyComparison: {
        quarter: `Q${currentQtr + 1}`,
        currentYear: { year: latestYear, total: currentQtrTotal, weeks: currentQtrInvoices.length },
        lastYear: { year: latestYear - 1, total: lastYearQtrTotal, weeks: lastYearQtrInvoices.length },
        change: currentQtrTotal - lastYearQtrTotal,
        changePct: lastYearQtrTotal ? Math.round(((currentQtrTotal - lastYearQtrTotal) / lastYearQtrTotal) * 1000) / 10 : null,
      },
    };
  }

  /**
   * Technician performance from detailed records
   */
  _getTechPerformance() {
    const records = this.historicalData.records || [];
    if (records.length === 0) return [];

    const techMap = {};
    for (const rec of records) {
      if (!rec.tech) continue;
      if (!techMap[rec.tech]) techMap[rec.tech] = { totalRevenue: 0, workOrders: 0, dates: new Set() };
      techMap[rec.tech].totalRevenue += rec.total || 0;
      techMap[rec.tech].workOrders++;
      if (rec.date) techMap[rec.tech].dates.add(rec.date);
    }

    return Object.entries(techMap)
      .map(([name, data]) => ({
        name,
        totalRevenue: data.totalRevenue,
        workOrders: data.workOrders,
        avgPerWO: data.workOrders ? Math.round(data.totalRevenue / data.workOrders) : 0,
        activeDays: data.dates.size,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  /**
   * Seasonality patterns
   */
  _getSeasonality(invoices) {
    const monthData = {};
    for (const inv of invoices) {
      if (!inv.weekEndingDate || !inv.grandTotal) continue;
      const month = new Date(inv.weekEndingDate).getMonth();
      if (!monthData[month]) monthData[month] = { totals: [], woCounts: [] };
      monthData[month].totals.push(inv.grandTotal);
      monthData[month].woCounts.push(inv.workOrderCount || 0);
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames.map((name, i) => {
      const data = monthData[i] || { totals: [], woCounts: [] };
      return {
        month: name,
        avgRevenue: data.totals.length ? Math.round(data.totals.reduce((s, t) => s + t, 0) / data.totals.length) : 0,
        avgWorkOrders: data.woCounts.length ? Math.round(data.woCounts.reduce((s, c) => s + c, 0) / data.woCounts.length) : 0,
        weeks: data.totals.length,
        peak: data.totals.length ? Math.max(...data.totals) : 0,
        low: data.totals.length ? Math.min(...data.totals) : 0,
      };
    });
  }

  /**
   * Helpers
   */
  _median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  _recentAverage(invoices, weeks) {
    const sorted = invoices.filter(i => i.grandTotal > 0).sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''));
    const recent = sorted.slice(-weeks);
    if (!recent.length) return 0;
    return Math.round(recent.reduce((s, i) => s + i.grandTotal, 0) / recent.length);
  }

  // ============================================================
  // REVENUE FORECASTING (Internal)
  // ============================================================

  /**
   * Get revenue forecasts using weighted moving average
   */
  getForecasts() {
    this.loadHistoricalData();
    const allInvoices = this.historicalData.invoices || [];
    const invoices = this._getEverfastInvoices(allInvoices)
      .filter(i => i.weekEndingDate && i.grandTotal > 0)
      .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate));

    if (invoices.length < 4) return { error: 'Not enough data for forecasting' };

    // Weighted moving average — recent weeks weighted more
    const forecast4 = this._weightedForecast(invoices, 4);
    const forecast8 = this._weightedForecast(invoices, 8);
    const forecast12 = this._weightedForecast(invoices, 12);

    // Monthly projection
    const monthlyProjection = this._monthlyProjection(invoices);

    // Confidence based on variance
    const recent12 = invoices.slice(-12).map(i => i.grandTotal);
    const mean = recent12.reduce((s, v) => s + v, 0) / recent12.length;
    const variance = recent12.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / recent12.length;
    const stdDev = Math.sqrt(variance);
    const confidencePct = Math.max(0, Math.min(100, Math.round(100 - (stdDev / mean) * 100)));

    // Actual vs forecast for chart overlay
    const actualVsForecast = invoices.slice(-20).map((inv, i, arr) => {
      const windowStart = Math.max(0, i - 4);
      const window = arr.slice(windowStart, i);
      const predicted = window.length > 0 ? Math.round(window.reduce((s, w) => s + w.grandTotal, 0) / window.length) : null;
      return {
        week: inv.weekEndingDate,
        actual: inv.grandTotal,
        predicted,
      };
    });

    return {
      nextWeek: {
        forecast4: forecast4.next,
        forecast8: forecast8.next,
        forecast12: forecast12.next,
        range: { low: Math.round(mean - stdDev), high: Math.round(mean + stdDev) },
      },
      next4Weeks: {
        projected: forecast4.next * 4,
        range: { low: Math.round((mean - stdDev) * 4), high: Math.round((mean + stdDev) * 4) },
      },
      next12Weeks: {
        projected: forecast8.next * 12,
        range: { low: Math.round((mean - stdDev) * 12), high: Math.round((mean + stdDev) * 12) },
      },
      confidence: confidencePct,
      monthlyProjection,
      actualVsForecast,
      trendDirection: forecast4.trend,
      currentAvg: Math.round(mean),
    };
  }

  _weightedForecast(invoices, windowSize) {
    const recent = invoices.slice(-windowSize);
    if (recent.length === 0) return { next: 0, trend: 'flat' };

    // Exponential weights — more recent = higher weight
    let totalWeight = 0, weightedSum = 0;
    for (let i = 0; i < recent.length; i++) {
      const weight = (i + 1); // Linear weight
      weightedSum += recent[i].grandTotal * weight;
      totalWeight += weight;
    }
    const next = Math.round(weightedSum / totalWeight);

    // Trend: compare first half avg vs second half avg
    const mid = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, mid).reduce((s, i) => s + i.grandTotal, 0) / mid;
    const secondHalf = recent.slice(mid).reduce((s, i) => s + i.grandTotal, 0) / (recent.length - mid);
    const trend = secondHalf > firstHalf * 1.05 ? 'up' : secondHalf < firstHalf * 0.95 ? 'down' : 'flat';

    return { next, trend };
  }

  _monthlyProjection(invoices) {
    // Average weeks per month ≈ 4.33
    const months = {};
    for (const inv of invoices) {
      const m = inv.weekEndingDate.substring(0, 7);
      if (!months[m]) months[m] = { revenue: 0, weeks: 0 };
      months[m].revenue += inv.grandTotal;
      months[m].weeks++;
    }

    const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    const last6 = sorted.slice(-6);
    const avgMonthlyRevenue = last6.reduce((s, [_, d]) => s + d.revenue, 0) / last6.length;

    // Project next 3 months
    const lastMonth = sorted[sorted.length - 1];
    const lastDate = new Date(lastMonth[0] + '-01');

    const projections = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(lastDate);
      d.setMonth(d.getMonth() + i);
      projections.push({
        month: d.toISOString().substring(0, 7),
        monthName: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
        projected: Math.round(avgMonthlyRevenue),
      });
    }

    return {
      avgMonthly: Math.round(avgMonthlyRevenue),
      projections,
      recentMonths: last6.map(([m, d]) => ({
        month: m,
        revenue: d.revenue,
        weeks: d.weeks,
      })),
    };
  }

  /**
   * What-if scenario modeling
   */
  runScenario(params) {
    this.loadHistoricalData();
    const invoices = this._getEverfastInvoices(this.historicalData.invoices || [])
      .filter(i => i.grandTotal > 0);

    if (invoices.length === 0) return { error: 'No data' };

    const records = this.historicalData.records || [];
    const currentTechs = {};
    records.forEach(r => {
      if (r.tech) currentTechs[r.tech] = (currentTechs[r.tech] || 0) + (r.total || 0);
    });

    const techCount = Object.keys(currentTechs).length;
    const totalRevenue = Object.values(currentTechs).reduce((s, v) => s + v, 0);
    const avgRevenuePerTech = techCount > 0 ? totalRevenue / techCount : 0;
    const weekCount = invoices.length;
    const avgWeeklyTotal = totalRevenue / weekCount;

    // Apply scenario adjustments
    const techAdjustment = (params.techCountChange || 0);
    const rateAdjustment = (params.rateChangePct || 0) / 100;

    const newTechCount = techCount + techAdjustment;
    const adjustedWeekly = avgWeeklyTotal * (newTechCount / techCount) * (1 + rateAdjustment);

    return {
      current: {
        techCount,
        avgWeeklyRevenue: Math.round(avgWeeklyTotal),
        avgMonthlyRevenue: Math.round(avgWeeklyTotal * 4.33),
        avgRevenuePerTech: Math.round(avgRevenuePerTech / weekCount),
      },
      scenario: {
        techCount: newTechCount,
        techChange: techAdjustment,
        rateChange: params.rateChangePct || 0,
        projectedWeekly: Math.round(adjustedWeekly),
        projectedMonthly: Math.round(adjustedWeekly * 4.33),
        weeklyDelta: Math.round(adjustedWeekly - avgWeeklyTotal),
        monthlyDelta: Math.round((adjustedWeekly - avgWeeklyTotal) * 4.33),
      },
    };
  }

  /**
   * Monthly P&L variance summary
   */
  getPnLSummary() {
    this.loadHistoricalData();
    const invoices = this._getEverfastInvoices(this.historicalData.invoices || [])
      .filter(i => i.weekEndingDate && i.grandTotal > 0)
      .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate));

    const months = {};
    for (const inv of invoices) {
      const m = inv.weekEndingDate.substring(0, 7);
      if (!months[m]) months[m] = { revenue: 0, weeks: 0, workOrders: 0 };
      months[m].revenue += inv.grandTotal;
      months[m].weeks++;
      months[m].workOrders += inv.workOrderCount || 0;
    }

    const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    let runningTotal = 0;

    return sorted.map(([month, data], i) => {
      const prevMonth = i > 0 ? sorted[i - 1][1] : null;
      const variance = prevMonth ? data.revenue - prevMonth.revenue : 0;
      const variancePct = prevMonth && prevMonth.revenue ? Math.round((variance / prevMonth.revenue) * 1000) / 10 : 0;
      runningTotal += data.revenue;

      return {
        month,
        revenue: data.revenue,
        weeks: data.weeks,
        workOrders: data.workOrders,
        variance,
        variancePct,
        runningTotal,
        avgPerWeek: Math.round(data.revenue / data.weeks),
      };
    });
  }
}

module.exports = AnalyticsEngine;

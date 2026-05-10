/**
 * CareGen Alliance Invoice Automation - Configuration
 * Central configuration for all automation modules
 */

const path = require('path');

module.exports = {
  // Company Information
  company: {
    name: 'SmartLink Services',
    billTo: 'EverFast Fiber',
    billToAttn: 'Accounts Payable',
    billToAddress: '9701 Lackman Rd',
    billToCity: 'Lenexa, KS 66219',
    type: 'Installation',
  },

  // Contacts
  contacts: {
    mike: {
      name: 'Mike Presler',
      email: 'michael.presler@everfastfiber.com',
      role: 'Everfast Operations - Sends daily work data, receives invoices',
    },
    marcus: {
      name: 'Marcus Martin',
      email: 'marcus@caregenalliance.com',
      altEmail: 'marcus@mygoldalliance.com',
      role: 'CareGen Data Compilation - Compiles weekly datasets',
    },
    kevin: {
      name: 'Kevin Crossley',
      email: 'kevin.crossley@everfastfiber.com',
      role: 'Everfast Recipient - Final invoice recipient',
    },
    donovan: {
      name: 'Donovan Martin',
      email: 'donovan@mygoldalliance.com',
      role: 'CareGen Internal - CC on communications',
    },
    shaun: {
      name: 'Shaun Muhammad',
      email: 'shaun@caregenalliance.com',
      role: 'CareGen QC & Invoicing',
    },
  },

  // Rate Card - Maps job types to their billing rates
  rates: {
    'TRIPLE PLAY': 185,
    'TRIPLE PLAY MDU': 125,
    'DOUBLE PLAY': 155,
    'DOUBLE PLAY MDU': 105,
    'SINGLE PLAY': 125,
    'SINGLE PLAY MDU': 85,
    'NEW OUTLET INCLUDING BATTERY OUTLET/CAT 5': 45,
    'NEW OUTLET SET TOP BOX': 55,
    'HOOK UP EXISTING OUTLET SAME TRIP': 15,
    'HOOKUP EXISTING OUTLET WITH SET-TOP BOX SAME': 25,
    'WALL-FISH': 65,
    'HOOK UP HOME NETWORK': 40,
    'CONNECTED HOME NETWORK': 40,
    'INSTALL NEW OR EXISTING OUTLET SEPARATE TRIP': 65,
    'INSTALL NEW OR EXISTING OUTLET SEPARATE TRIP W/STB': 75,
    'TRIP CHARGE': 40,
    'EMTA CONVERSION': 85,
    'EMTA CONVERSION INCLUDING SCHEDULING': 85,
    'SUPERVISOR/HEAD END HELP': 50,
    'REPLACE DROP': 30,
  },

  // File paths
  paths: {
    dataDir: path.join(__dirname, 'data'),
    uploadsDir: path.join(__dirname, 'uploads'),
    outputDir: path.join(__dirname, 'output'),
    masterFile: path.join(__dirname, 'data', 'master_consolidated.xlsx'),
    archiveDir: path.join(__dirname, 'archive'),
  },

  // Invoice configuration
  invoice: {
    prefix: 'Everfast Invoice',
    datasetPrefix: 'Everfast DataSet',
    startingNumber: 241, // Will be auto-detected from master file
  },

  // QC Thresholds
  qc: {
    maxDailyOrders: 50, // Flag if more than 50 orders in a day
    minDailyOrders: 1,  // Flag if no orders
    maxOrderTotal: 500,  // Flag individual orders over $500
    duplicateCheckFields: ['Work Order Number'], // Fields to check for duplicates
    requiredFields: ['Work Order Date', 'Work Order Number', 'Tech Name', 'Base Work Order Type'],
  },

  // Server
  server: {
    port: process.env.PORT || 3500,
  },
};

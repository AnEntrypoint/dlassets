#!/usr/bin/env node

// Standalone script to run the downloader
// This can be executed from the command line or via Node.js
// It will use the existing Playwriter browser context if available

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Starting USDZ downloader...\n');

  // Load the downloader module
  const downloadAllAssets = require('./usdz-download.js');

  // The downloader needs a browser context
  // This should be called from Playwriter, but let's try with playwright directly

  try {
    const { chromium } = require('playwright');

    console.log('Connecting to browser...');

    // Try to connect to existing browser (if Playwriter has one running)
    // Otherwise start a new one
    let browser, context;

    try {
      // Try connecting to existing Chrome
      browser = await chromium.connectOverCDP('http://localhost:9222');
      console.log('Connected to existing browser instance');

      const contexts = browser.contexts();
      context = contexts[0] || await browser.newContext();
      console.log(`Using browser context with ${context.pages().length} pages`);
    } catch (e) {
      console.log('Could not connect to existing browser, starting new instance...');
      browser = await chromium.launch({ headless: false });
      context = await browser.newContext();
      console.log('Started new browser instance');
    }

    // Run the downloader
    console.log('\nRunning downloader...\n');
    await downloadAllAssets(context);

    console.log('\nDownloader completed successfully!');

    // Don't close - keep browser open
    if (browser) {
      // Keep running
      console.log('Browser is still running. Close manually when done.');
    }

  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(console.error);

// Minimal wrapper to invoke the downloader from Playwriter
// This avoids complex logic in the Playwriter executor timeout

const downloadAllAssets = require('./usdz-download.js');

// Entry point - called with browser context
module.exports = async function runDownloader(context) {
  try {
    console.log('Starting USDZ downloader...');
    console.log(`Browser context: ${context.pages().length} pages available`);

    await downloadAllAssets(context);

    console.log('Downloader completed');
  } catch (error) {
    console.error(`Downloader error: ${error.message}`);
    throw error;
  }
};

// If run directly (for testing)
if (require.main === module) {
  console.log('This module must be invoked from Playwriter with a browser context');
}

# Asset Cleanup & Completion Workflow

**Status**: Ready for Execution
**Date**: February 15, 2026

## Overview

This workflow cleans up suspicious metadata files and ensures every asset has all 4 versions.

## Quick Start

```bash
node /c/usdz/execute-cleanup.js
```

## What Gets Done

### Phase 1: Delete Suspicious Files
- Removes 8 small files (< 1 MB) that are metadata only
- Files: gun.glb, bike.glb, bike (2).glb, computer_pile.glb, computer_pile (3).glb, barrel (3).glb, barrel (6).glb, minivan (3).glb

### Phase 2: Analyze Current Structure
- Lists all files in /c/usdz/downloads
- Groups files by asset name
- Identifies how many versions each asset has

### Phase 3: Query API
- Loads session from browser-session.json
- Queries /api/3d/creations/list endpoint
- Discovers the 4 versions available for each asset
- Uses browser automation as fallback if session invalid

### Phase 4: Generate Download Plan
- Maps local files to API assets
- Identifies missing versions
- Creates plan to reach 8 assets × 4 versions = 32 files

## Expected Results

Before cleanup:
- ~28 files
- Several files < 1 MB (metadata)
- Some assets with only 2-3 versions

After cleanup:
- 32 files total
- All files > 5 MB (real models)
- All assets with exactly 4 versions
- ~400-600 MB total

## Files Created

1. **execute-cleanup.js** - Main execution script (650 lines)
2. **cleanup-and-complete.js** - Simplified version (400 lines)

## API Structure Reference

Each asset in the API response contains:

```json
{
  "id": "asset-uuid",
  "name": "Asset Name",
  "urlResult": {
    "glb": "https://...",      // OpenGL format
    "usdz": "https://...",     // Apple format
    "obj": "https://...",      // Universal format
    "fbx": "https://..."       // Game engine format
  }
}
```

## How to Use

1. Run the script: `node /c/usdz/execute-cleanup.js`
2. Watch the 4 phases execute
3. Review the download plan in Phase 4
4. If needed, run `npm run download` to complete remaining downloads
5. Verify with: `ls -1 /c/usdz/downloads/ | wc -l` (should be 32)

## Troubleshooting

**If session is invalid:**
- The script automatically uses browser automation
- Will navigate to /assets page and intercept API calls
- Requires valid Hunyuan 3D login session

**If API query times out:**
- Check internet connection
- Ensure browser-session.json is valid
- Try running npm run download instead

**If downloads fail:**
- Check available disk space
- Verify internet connection stability
- Session may have expired (30-day TTL)

## Manual Commands

```bash
# View current files
ls -lhS /c/usdz/downloads/

# Count files
ls -1 /c/usdz/downloads/ | wc -l

# Check total size
du -sh /c/usdz/downloads/

# Look for metadata files
find /c/usdz/downloads -type f -size -1M
```

## Architecture

The scripts are production-ready with:
- Real file operations (no test mocks)
- Session-based authentication
- API fallback strategies
- Comprehensive error handling
- Detailed logging throughout

## Dependencies

- Node.js (includes fs, https, path modules)
- Playwright (for browser automation fallback)
- Valid session in browser-session.json (optional, falls back to browser)

## Notes

- All execution happens in real mode (no simulations)
- Real API responses parsed and analyzed
- Real files deleted and downloaded
- Complete audit trail in console output

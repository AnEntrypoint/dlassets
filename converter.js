const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class AssetConverter {
  constructor(options = {}) {
    this.blenderPath = options.blenderPath || 'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe';
    this.downloadsDir = options.downloadsDir || path.join(__dirname, 'downloads');
    this.outputDir = options.outputDir || path.join(this.downloadsDir, 'converted');
    this.tempScriptDir = path.join(__dirname, 'converter-script');
    this.verbose = options.verbose !== false;
  }

  async convert(inputFormat, outputFormat) {
    if (inputFormat === 'usdz' && outputFormat === 'glb') {
      return this.convertUSdzToGlb();
    }
    throw new Error(`Conversion from ${inputFormat} to ${outputFormat} not supported`);
  }

  async convertUSdzToGlb() {
    const inputDir = this.downloadsDir;
    const outputDir = this.outputDir;

    if (!fs.existsSync(inputDir)) {
      throw new Error(`Input directory not found: ${inputDir}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      this.log(`Created output directory: ${outputDir}`);
    }

    const usdzFiles = fs.readdirSync(inputDir)
      .filter(f => f.endsWith('.usdz'))
      .map(f => path.join(inputDir, f));

    if (usdzFiles.length === 0) {
      this.log('No USDZ files found to convert');
      return { converted: 0, files: [] };
    }

    this.log(`Found ${usdzFiles.length} USDZ files to convert`);

    const pythonScript = this.generateBlenderScript(usdzFiles, outputDir);
    const tempScriptPath = path.join(__dirname, 'converter-temp-script.py');

    try {
      fs.writeFileSync(tempScriptPath, pythonScript);
      return await this.executeBlenderConversion(tempScriptPath);
    } finally {
      if (fs.existsSync(tempScriptPath)) {
        fs.unlinkSync(tempScriptPath);
      }
    }
  }

  generateBlenderScript(usdzFiles, outputDir) {
    const filesList = usdzFiles.map(f => `"${f.replace(/\\/g, '\\\\')}"`)
      .join(', ');

    return `import bpy
import sys
import os

output_dir = "${outputDir.replace(/\\/g, '\\\\')}"
os.makedirs(output_dir, exist_ok=True)

usdz_files = [${filesList}]

for usdz_path in usdz_files:
    name = os.path.splitext(os.path.basename(usdz_path))[0]
    glb_path = os.path.join(output_dir, name + ".glb")

    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.usd_import(filepath=usdz_path)

        bpy.ops.export_scene.gltf(
            filepath=glb_path,
            export_format='GLB',
            export_image_format='WEBP',
            export_image_add_webp=False,
            export_image_quality=15,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
        )
        print(f"DONE: {glb_path}")
    except Exception as e:
        print(f"ERROR converting {usdz_path}: {str(e)}")
`;
  }

  async executeBlenderConversion(scriptPath) {
    return new Promise((resolve, reject) => {
      const args = ['--background', '--python', scriptPath];

      this.log(`Starting Blender conversion process...`);
      this.log(`Blender: ${this.blenderPath}`);

      const process = spawn(this.blenderPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (this.verbose && text.trim()) {
          console.log(`[Blender] ${text.trim()}`);
        }
      });

      process.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (this.verbose && text.trim()) {
          console.log(`[Blender Error] ${text.trim()}`);
        }
      });

      const timeout = setTimeout(() => {
        process.kill();
        reject(new Error('Blender conversion timeout after 5 minutes'));
      }, 5 * 60 * 1000);

      process.on('close', (code) => {
        clearTimeout(timeout);

        const convertedFiles = this.parseBlenderOutput(stdout);

        if (code === 0 || convertedFiles.length > 0) {
          this.log(`Conversion complete: ${convertedFiles.length} files created`);
          resolve({
            converted: convertedFiles.length,
            files: convertedFiles,
            stdout,
            stderr,
          });
        } else {
          reject(new Error(`Blender process exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start Blender: ${err.message}`));
      });
    });
  }

  parseBlenderOutput(output) {
    const lines = output.split('\n');
    const files = [];

    lines.forEach(line => {
      if (line.includes('DONE:')) {
        const match = line.match(/DONE:\s*(.+)/);
        if (match) {
          const filePath = match[1].trim();
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            files.push({
              path: filePath,
              filename: path.basename(filePath),
              size: stat.size,
              sizeMB: (stat.size / 1024 / 1024).toFixed(2),
            });
          }
        }
      }
    });

    return files;
  }

  getConvertedFiles() {
    if (!fs.existsSync(this.outputDir)) {
      return [];
    }

    return fs.readdirSync(this.outputDir)
      .filter(f => f.endsWith('.glb'))
      .map(f => {
        const fullPath = path.join(this.outputDir, f);
        const stat = fs.statSync(fullPath);
        return {
          filename: f,
          path: fullPath,
          size: stat.size,
          sizeBytes: stat.size,
          sizeMB: (stat.size / 1024 / 1024).toFixed(2),
          created: stat.birthtime,
        };
      })
      .sort((a, b) => b.created - a.created);
  }

  log(message) {
    if (this.verbose) {
      console.log(`[Converter] ${message}`);
    }
  }
}

module.exports = AssetConverter;

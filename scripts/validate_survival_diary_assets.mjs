import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'apps/SurvivalDiaryShared/assets/asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const missing = [];
const placeholders = [];
const invalidDimensions = [];
const invalidFormats = [];
const structureOnly = process.argv.includes('--structure-only');
const banned = /\.(svg)$/i;
const placeholderPattern = /emoji|placeholder|wireframe|line[-_ ]?art/i;

function pngMetadata(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature || bytes.length < 33) return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
    paletteTransparency: bytes.includes(Buffer.from('tRNS')),
  };
}

for (const [imageKey, asset] of Object.entries(manifest.assets || {})) {
  if (!asset.variants || Object.keys(asset.variants).length === 0) missing.push(`${imageKey}:variants`);
  for (const [state, definition] of Object.entries(asset.variants || {})) {
    const descriptor = `${imageKey}:${state}`;
    if (banned.test(definition.path) || definition.format !== 'png') invalidFormats.push(descriptor);
    if (placeholderPattern.test(`${imageKey} ${definition.path}`)) placeholders.push(descriptor);
    if (structureOnly) continue;
    const absolutePath = path.join(root, definition.path);
    if (!fs.existsSync(absolutePath)) {
      missing.push(descriptor);
      continue;
    }
    const bytes = fs.readFileSync(absolutePath);
    const metadata = pngMetadata(bytes);
    if (
      !metadata
      || metadata.width !== definition.width
      || metadata.height !== definition.height
      || !([4, 6].includes(metadata.colorType) || (
        metadata.colorType === 3 && metadata.paletteTransparency
      ))
    ) invalidDimensions.push(descriptor);
    if (bytes.length < 768) placeholders.push(descriptor);
  }
}

const harmonySource = path.join(root, manifest.harmonyIcon.source);
if (!fs.existsSync(harmonySource)) missing.push('harmony-icon');
else {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(harmonySource)).digest('hex');
  if (digest !== manifest.harmonyIcon.sha256) placeholders.push('harmony-icon-mutated');
}

const result = {
  valid: missing.length === 0
    && placeholders.length === 0
    && invalidDimensions.length === 0
    && invalidFormats.length === 0,
  missing,
  placeholders,
  invalidDimensions,
  invalidFormats,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.valid) process.exitCode = 1;

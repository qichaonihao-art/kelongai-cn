import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error('Usage: node generate-painting-scale-reference.mjs <product-image> <output-png>');
}

const canvasWidth = 1080;
const canvasHeight = 1920;

// A 205 cm door is represented by 1200 px. The 80 cm product body is
// therefore 468 px tall. These values preserve the real 80:205 ratio.
const door = { left: 105, top: 340, width: 527, height: 1200 };
const floorY = door.top + door.height;
const productBody = { left: 755, top: 457, width: 234, height: 468 };

// Coordinates of the physical 40 x 80 cm product body in the supplied
// 944 x 1698 source photo. The rope and hook remain visible above it.
const sourceBody = { left: 103, top: 307, width: 680, height: 1323 };
const scale = productBody.height / sourceBody.height;

const sourceMetadata = await sharp(inputPath).metadata();
const resizedWidth = Math.round((sourceMetadata.width ?? 944) * scale);
const resizedHeight = Math.round((sourceMetadata.height ?? 1698) * scale);
const productLeft = Math.round(productBody.left - sourceBody.left * scale);
const productTop = Math.round(productBody.top - sourceBody.top * scale);

const templateSvg = `
<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1920" fill="#f4f2ed"/>
  <text x="540" y="105" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#263238">SCALE REFERENCE ONLY</text>
  <text x="540" y="148" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="#607079">NOT A VIDEO FRAME OR SCENE REFERENCE</text>

  <line x1="58" y1="${floorY}" x2="1022" y2="${floorY}" stroke="#7b858b" stroke-width="4"/>
  <text x="58" y="${floorY + 42}" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#607079">FLOOR LINE</text>

  <rect x="${door.left}" y="${door.top}" width="${door.width}" height="${door.height}" rx="4" fill="#dedfdd" stroke="#33434c" stroke-width="8"/>
  <rect x="${door.left + 42}" y="${door.top + 58}" width="${door.width - 84}" height="${door.height - 116}" rx="3" fill="#eef0ef" stroke="#8c989e" stroke-width="3"/>
  <circle cx="${door.left + door.width - 60}" cy="${door.top + door.height * 0.53}" r="12" fill="#586970"/>
  <text x="${door.left + door.width / 2}" y="${door.top + door.height + 78}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#33434c">STANDARD DOOR 90 × 205 cm</text>

  <line x1="72" y1="${door.top}" x2="72" y2="${floorY}" stroke="#4b6978" stroke-width="3"/>
  <line x1="56" y1="${door.top}" x2="88" y2="${door.top}" stroke="#4b6978" stroke-width="3"/>
  <line x1="56" y1="${floorY}" x2="88" y2="${floorY}" stroke="#4b6978" stroke-width="3"/>
  <text x="50" y="${door.top + door.height / 2}" transform="rotate(-90 50 ${door.top + door.height / 2})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#4b6978">205 cm</text>

  <rect x="${productBody.left - 18}" y="${productBody.top - 18}" width="${productBody.width + 36}" height="${productBody.height + 36}" rx="8" fill="none" stroke="#d28b23" stroke-width="3" stroke-dasharray="10 9"/>
  <line x1="${productBody.left + productBody.width + 34}" y1="${productBody.top}" x2="${productBody.left + productBody.width + 34}" y2="${productBody.top + productBody.height}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width + 20}" y1="${productBody.top}" x2="${productBody.left + productBody.width + 48}" y2="${productBody.top}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width + 20}" y1="${productBody.top + productBody.height}" x2="${productBody.left + productBody.width + 48}" y2="${productBody.top + productBody.height}" stroke="#b66a12" stroke-width="3"/>
  <text x="${productBody.left + productBody.width + 66}" y="${productBody.top + productBody.height / 2}" transform="rotate(-90 ${productBody.left + productBody.width + 66} ${productBody.top + productBody.height / 2})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#b66a12">80 cm</text>

  <line x1="${productBody.left}" y1="${productBody.top + productBody.height + 35}" x2="${productBody.left + productBody.width}" y2="${productBody.top + productBody.height + 35}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left}" y1="${productBody.top + productBody.height + 21}" x2="${productBody.left}" y2="${productBody.top + productBody.height + 49}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width}" y1="${productBody.top + productBody.height + 21}" x2="${productBody.left + productBody.width}" y2="${productBody.top + productBody.height + 49}" stroke="#b66a12" stroke-width="3"/>
  <text x="${productBody.left + productBody.width / 2}" y="${productBody.top + productBody.height + 72}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#b66a12">40 cm</text>

  <rect x="86" y="1695" width="908" height="142" rx="18" fill="#e7ecee"/>
  <text x="540" y="1750" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#33434c">PHYSICAL HEIGHT RATIO: 80 / 205 = 39%</text>
  <text x="540" y="1793" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#607079">Use only for product scale. Ignore this layout, door, labels and background.</text>
</svg>`;

const resizedProduct = await sharp(inputPath)
  .resize(resizedWidth, resizedHeight, { fit: 'fill' })
  .png()
  .toBuffer();

const annotationOverlay = Buffer.from(`
<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${productBody.left - 18}" y="${productBody.top - 18}" width="${productBody.width + 36}" height="${productBody.height + 36}" rx="8" fill="none" stroke="#d28b23" stroke-width="3" stroke-dasharray="10 9"/>
  <line x1="${productBody.left + productBody.width + 34}" y1="${productBody.top}" x2="${productBody.left + productBody.width + 34}" y2="${productBody.top + productBody.height}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width + 20}" y1="${productBody.top}" x2="${productBody.left + productBody.width + 48}" y2="${productBody.top}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width + 20}" y1="${productBody.top + productBody.height}" x2="${productBody.left + productBody.width + 48}" y2="${productBody.top + productBody.height}" stroke="#b66a12" stroke-width="3"/>
  <text x="${productBody.left + productBody.width + 66}" y="${productBody.top + productBody.height / 2}" transform="rotate(-90 ${productBody.left + productBody.width + 66} ${productBody.top + productBody.height / 2})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#b66a12">80 cm</text>
  <line x1="${productBody.left}" y1="${productBody.top + productBody.height + 35}" x2="${productBody.left + productBody.width}" y2="${productBody.top + productBody.height + 35}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left}" y1="${productBody.top + productBody.height + 21}" x2="${productBody.left}" y2="${productBody.top + productBody.height + 49}" stroke="#b66a12" stroke-width="3"/>
  <line x1="${productBody.left + productBody.width}" y1="${productBody.top + productBody.height + 21}" x2="${productBody.left + productBody.width}" y2="${productBody.top + productBody.height + 49}" stroke="#b66a12" stroke-width="3"/>
  <text x="${productBody.left + productBody.width / 2}" y="${productBody.top + productBody.height + 72}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#b66a12">40 cm</text>
</svg>`);

await sharp(Buffer.from(templateSvg))
  .composite([
    { input: resizedProduct, left: productLeft, top: productTop },
    { input: annotationOverlay, left: 0, top: 0 },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(path.resolve(outputPath));

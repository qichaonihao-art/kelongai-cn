import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error('Usage: node generate-painting-occupancy-reference.mjs <product-image> <output-png>');
}

const canvasWidth = 1080;
const canvasHeight = 1920;

// Physical product body coordinates in the 944 x 1698 source photo.
// The body from the upper wooden rail to the lower wooden rail is placed at
// exactly 20% of the 9:16 reference canvas height. Rope and hook stay visible.
const sourceBody = { left: 103, top: 307, width: 680, height: 1323 };
const targetBodyHeight = Math.round(canvasHeight * 0.2);
const targetBodyWidth = Math.round(targetBodyHeight * 0.5);
const scale = targetBodyHeight / sourceBody.height;

const source = sharp(inputPath);
const metadata = await source.metadata();

// Fixed neutral gray avoids transferring the source photo's warm wall color
// into the generated video as an unintended style reference.
const background = { r: 234, g: 234, b: 232 };

const resizedWidth = Math.round((metadata.width ?? 944) * scale);
const resizedHeight = Math.round((metadata.height ?? 1698) * scale);
const targetBodyLeft = Math.round((canvasWidth - targetBodyWidth) / 2);
const targetBodyTop = Math.round((canvasHeight - targetBodyHeight) / 2);
const productLeft = Math.round(targetBodyLeft - sourceBody.left * scale);
const productTop = Math.round(targetBodyTop - sourceBody.top * scale);

const resizedProduct = await sharp(inputPath)
  .resize(resizedWidth, resizedHeight, { fit: 'fill' })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: canvasWidth,
    height: canvasHeight,
    channels: 3,
    background,
  },
})
  .composite([{ input: resizedProduct, left: productLeft, top: productTop }])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(path.resolve(outputPath));

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

await sharp(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)))
  .resize(96, 96)
  .png()
  .toFile(fileURLToPath(new URL('../public/favicon.png', import.meta.url)));
console.log('Generated public/favicon.png (96 × 96) from the vector master.');

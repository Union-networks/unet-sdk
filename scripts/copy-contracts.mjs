import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('packages/contracts/dist/generated', { recursive: true });
copyFileSync('packages/contracts/src/generated/unet-public-api-v2.d.ts', 'packages/contracts/dist/generated/unet-public-api-v2.d.ts');

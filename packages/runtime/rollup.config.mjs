import { config } from '@y-kafka-collabation-server/rollup-config';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default config({
  external: [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    /^node:/,
    'http',
    'https',
    'util',
    'events',
    'stream',
    'path',
    'fs',
    'crypto',
    'zlib',
  ],
});

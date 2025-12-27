import { config } from '@y-kafka-collabation-server/rollup-config';

export default config({
  external: [
    'reflect-metadata',
    'typeorm',
    'mysql2',
    '@y-kafka-collabation-server/protocol'
  ]
});

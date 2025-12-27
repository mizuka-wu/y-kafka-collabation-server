import { config } from '@y-kafka-collabation-server/rollup-config';

export default config({
  external: [
    '@y/protocols',
    '@y/y',
    'lib0'
  ]
});

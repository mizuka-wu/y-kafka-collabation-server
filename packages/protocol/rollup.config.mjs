import { config } from '@y-kafka-collabation-server/rollup-config';

export default config({
  external: ['@y/protocols', 'yjs', 'lib0', 'lib0/encoding', 'lib0/decoding']
});

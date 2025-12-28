import { config } from '@y-kafka-collabation-server/rollup-config';

export default config({
  external: [
    '@y-kafka-collabation-server/protocol',
    'y-protocols',
    'yjs',
    'socket.io-client',
    'lib0',
    'lib0/buffer'
  ]
});

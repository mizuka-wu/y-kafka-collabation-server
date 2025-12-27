import { config } from '@y-kafka-collabation-server/rollup-config';

export default config({
  external: [
    '@y-kafka-collabation-server/protocol',
    'lib0',
    'socket.io'
  ]
});

import {
  MultiplexedSocketManager,
  createVirtualWebSocketFactory,
} from '@y-kafka-collabation-server/provider';

let manager: MultiplexedSocketManager | null = null;
let Factory: any = null;

export const getMultiplexedSocketFactory = (url: string) => {
  if (!manager) {
    manager = new MultiplexedSocketManager(url);
    Factory = createVirtualWebSocketFactory(manager);
  }
  return Factory;
};

export const disconnectMultiplexedSocket = () => {
  if (manager) {
    manager.disconnect();
    manager = null;
    Factory = null;
  }
};

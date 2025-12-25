import { Socket } from 'socket.io';
import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

export type BusClientChannel = 'doc' | 'awareness' | 'control';

export interface BusClientMessage {
  payload: Uint8Array | Buffer | string;
  metadata: ProtocolMessageMetadata & { roomId?: string };
  channel?: BusClientChannel;
}

export interface KafkaMessage {
  topic: string;
  partition?: number;
  offset?: string;
  value: Uint8Array | Buffer | null;
}

export interface KafkaConsumerRunConfig {
  eachMessage: (payload: KafkaMessage) => Promise<void>;
}

export interface KafkaConsumer {
  subscribe(topic: string): Promise<void>;
  run(config: KafkaConsumerRunConfig): Promise<void>;
  stop?(): Promise<void>;
}

export interface KafkaProducer {
  produce(params: {
    topic: string;
    messages: { value: Uint8Array | Buffer }[];
  }): Promise<void>;
}

export interface TopicResolver {
  resolveDocTopic(roomId: string): string;
  resolveAwarenessTopic(roomId: string): string;
  resolveControlTopic?(roomId: string): string;
  docTopicPattern?: string;
  awarenessTopicPattern?: string;
}

export interface ProtocolCodecAdapter {
  encodeKafkaEnvelope: (
    payload: Uint8Array,
    metadata: ProtocolMessageMetadata,
  ) => Uint8Array;
  decodeKafkaEnvelope: (buffer: Uint8Array) => {
    metadata: ProtocolMessageMetadata;
    payload: Uint8Array;
  };
}

export interface RoomAssignment {
  roomId: string;
  subdocId?: string;
}

export interface RoomRegistry {
  add(socket: Socket, assignment: RoomAssignment): void;
  remove(socket: Socket): void;
  getSockets(roomId: string, subdocId?: string): Socket[];
}

export interface TransportSocketHandlers {
  handleConnection: (socket: Socket, assignment: RoomAssignment) => void;
  handleClientMessage: (
    socket: Socket,
    message: BusClientMessage,
  ) => Promise<void>;
  handleDisconnect: (socket: Socket) => void;
}

export interface CreateBusSocketHandlersDeps {
  roomRegistry: RoomRegistry;
  kafkaProducer: KafkaProducer;
  protocolCodec: ProtocolCodecAdapter;
  topicResolver: TopicResolver;
}

export interface CreateTransportSocketHandlersDeps {
  roomRegistry: RoomRegistry;
  kafkaProducer: KafkaProducer;
  protocolCodec: ProtocolCodecAdapter;
  topicResolver: TopicResolver;
}

export interface StartKafkaConsumerDeps {
  kafkaConsumer: KafkaConsumer;
  roomRegistry: RoomRegistry;
  protocolCodec: ProtocolCodecAdapter;
  topicResolver: TopicResolver;
  onMessageEvent?: 'protocol-message' | string;
  onMessageProcessed?: (
    metadata: ProtocolMessageMetadata,
    payload: Uint8Array,
  ) => Promise<void>;
}

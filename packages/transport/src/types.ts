import { Socket } from 'socket.io';
import type {
  ProtocolMessageMetadata,
  ProtocolMessageType,
} from '@y-kafka-collabation-server/protocol';

export enum Channel {
  /** 协同链路 */
  Sync = 'sync',
  /** 客户端状态 */
  Awareness = 'awareness',
  /** 控制命令 */
  Control = 'control',
}

/**
 * 客户端发送的消息。
 */
export interface ClientOutgoingMessage {
  payload: Uint8Array | Buffer | string;
  metadata: ProtocolMessageMetadata;
  channel: Channel;
}

/**
 * Kafka 消息。
 */
export interface KafkaMessage {
  topic: string;
  partition?: number;
  offset?: string;
  value: Uint8Array | Buffer | null;
}

/**
 * Kafka 消费者配置。
 */
export interface KafkaConsumerRunConfig {
  /** 是否自动提交 offset */
  autoCommit?: boolean;
  /** 消费失败时是否重启 */
  restartOnFailure?: (error: Error) => Promise<boolean>;
  /** 消费一条消息 */
  eachMessage: (payload: KafkaMessage) => Promise<void>;
}

/**
 * Kafka 消费者。
 */
export interface KafkaConsumer {
  /** 订阅 topic 这里只能是字符串，因为虽然 kafkajs 支持正则但是新建的是监听不了的，所以需要动态内部管理 */
  subscribe(topic: string): Promise<void>;
  /** 开始消费 */
  run(config: KafkaConsumerRunConfig): Promise<void>;
  /** 停止消费 */
  stop?(): Promise<void>;
}

/** Kafka 生产者。 */
export interface KafkaProducer {
  /** 发送消息 */
  produce(params: {
    topic: string;
    messages: { value: Uint8Array | Buffer }[];
  }): Promise<void>;
}

/** Topic 解析器。 */
export interface TopicResolver {
  resolveSyncTopic(metadata: ProtocolMessageMetadata): string;
  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string;
  resolveControlTopic?(metadata: ProtocolMessageMetadata): string;
  syncTopicPattern?: RegExp;
  awarenessTopicPattern?: RegExp;
  controlTopicPattern?: RegExp;
}

/** 协议编解码器。 */
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

/** 房间分配。 */
export interface RoomAssignment {
  roomId: string;
  docId: string;
  subdocId?: string;
}

/**
 * 房间注册表
 * 目的为方便向连接的 socket 下发内容
 */
export interface RoomRegistry {
  add(socket: Socket, assignment: RoomAssignment): void;
  remove(socket: Socket): void;
  getSockets(docId: string, subdocId?: string): Socket[];
}

/**
 * Socket handler 集合：
 * - `handleConnection`：Socket.IO 连接建立时调用，负责注册 socket
 * - `handleClientMessage`：Socket.IO 收到消息时调用，负责写入 Kafka
 * - `handleDisconnect`：Socket.IO 断开连接时调用，负责从注册表中移除 socket
 */
export interface TransportSocketHandlers {
  handleConnection: (socket: Socket, assignment: RoomAssignment) => void;
  handleClientMessage: (
    socket: Socket,
    message: ClientOutgoingMessage,
  ) => Promise<void>;
  handleDisconnect: (socket: Socket) => void;
}

/** 创建 socket handlers 的依赖。 */
export interface CreateSocketHandlersDeps {
  /** 房间注册表 */
  roomRegistry: RoomRegistry;
  /** Kafka 生产者 */
  kafkaProducer: KafkaProducer;
  /** 协议编解码器 */
  protocolCodec: ProtocolCodecAdapter;
  /** Topic 解析器 */
  topicResolver: TopicResolver;
}

/**
 * 创建 socket handlers 的依赖。
 */
export interface CreateTransportSocketHandlersDeps {
  roomRegistry: RoomRegistry;
  kafkaProducer: KafkaProducer;
  protocolCodec: ProtocolCodecAdapter;
  topicResolver: TopicResolver;
}

/** 开始消费 Kafka 的依赖。 */
export interface StartKafkaConsumerDeps {
  kafkaConsumer: KafkaConsumer;
  roomRegistry: RoomRegistry;
  protocolCodec: ProtocolCodecAdapter;
  topicResolver: TopicResolver;
  onMessageEvent?: ProtocolMessageType | string;
  onMessageProcessed?: (
    metadata: ProtocolMessageMetadata,
    payload: Uint8Array,
  ) => Promise<void>;
}

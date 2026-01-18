import type { Socket } from 'socket.io';
import type { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

export const SOCKET_IO_EVENT_PREFIX = 'y-kafka-collabation-server';

export enum Channel {
  /** 协同链路 */
  Sync = 'sync',
  /** 客户端状态 */
  Awareness = 'awareness',
  /** 控制命令 */
  Control = 'control',
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
  /** 订阅指定 topic。 */
  subscribe(topic: string): Promise<void>;
  /** 取消订阅指定 topic。 */
  unsubscribe?(topic: string): Promise<void>;
  /** 输出当前已订阅的 topic 列表。 */
  listSubscriptions?(): Promise<string[]>;
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
    messages: {
      value: Uint8Array | Buffer;
      key?: string | Buffer | null;
    }[];
  }): Promise<void>;
}

export type TopicResolverInput = ProtocolMessageMetadata | string;

/** Topic 解析器。 */
export interface TopicResolver {
  prefix: string;
  resolveSyncTopic(input: TopicResolverInput): string;
  resolveAwarenessTopic(input: TopicResolverInput): string;
  resolveControlTopic?(input: TopicResolverInput): string;
  parseChannelFromTopic(topic: string): Channel;
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
  parentId?: string;
}

/** 房间加入/移除事件。 */
export type RoomPresenceChange = {
  type: 'added' | 'removed';
  roomId: string;
};

/**
 * 房间注册表
 * 目的为方便向连接的 socket 下发内容
 */
export interface RoomRegistry {
  add(socket: Socket, assignment: RoomAssignment): void;
  remove(socket: Socket): void;
  getSockets(roomId: string, docId?: string, parentId?: string): Socket[];
  getRooms(): string[];
  onRoomChange(listener: (change: RoomPresenceChange) => void): () => void;
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
    channel: Channel,
    message: Uint8Array,
  ) => Promise<void>;
  handleDisconnect: (socket: Socket) => void;
}

/** 创建 socket handlers 的依赖。 */
export interface CreateSocketHandlersDeps {
  /** 房间注册表 */
  roomRegistry: RoomRegistry;
  /** Kafka 生产者 */
  kafkaProducer: KafkaProducer;
  /** Topic 解析器 */
  topicResolver: TopicResolver;
  /**
   * 自定义 Awareness 消息处理逻辑。
   * 如果提供，Awareness 消息将调用此函数而不是发送到 Kafka。
   */
  onAwarenessUpdate?: (
    socket: Socket,
    metadata: ProtocolMessageMetadata,
    message: Uint8Array,
  ) => Promise<void>;
}

/**
 * 创建 socket handlers 的依赖。
 */
export interface CreateTransportSocketHandlersDeps {
  roomRegistry: RoomRegistry;
  kafkaProducer: KafkaProducer;
  topicResolver: TopicResolver;
}

/** 开始消费 Kafka 的依赖。 */
export interface StartKafkaConsumerDeps {
  kafkaConsumer: KafkaConsumer;
  roomRegistry: RoomRegistry;
  topicResolver: TopicResolver;
  /**
   * If true, the consumer will not subscribe to awareness topics.
   * Useful when using Redis for awareness.
   */
  disableAwarenessConsumer?: boolean;
}

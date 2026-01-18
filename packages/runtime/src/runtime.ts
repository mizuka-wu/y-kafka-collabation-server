import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import {
  createSocketMessageTransportHandlers,
  startKafkaConsumer,
  DefaultRoomRegistry,
  DefaultTopicResolver,
  RoomAssignment,
  Channel,
  getSocketIOEvent,
  KafkaProducer as IKafkaProducer,
  KafkaConsumer as IKafkaConsumer,
  KafkaConsumerRunConfig,
} from '@y-kafka-collabation-server/transport';
import {
  TypeOrmPersistenceAdapter,
  PersistenceCoordinator,
  PersistenceMetadata,
} from '@y-kafka-collabation-server/persistence';
import {
  ProtocolMessageType,
  decodeEnvelope,
  encodeEnvelope,
} from '@y-kafka-collabation-server/protocol';
import { YKafkaRuntimeConfig } from './types';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { messageYjsSyncStep2 } from 'y-protocols/sync';
import { mergeUpdatesV1 } from 'ywasm';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';

class KafkaProducerAdapter implements IKafkaProducer {
  constructor(private producer: Producer) {}
  async produce(params: {
    topic: string;
    messages: { value: Uint8Array | Buffer; key?: string | Buffer | null }[];
  }): Promise<void> {
    await this.producer.send({
      topic: params.topic,
      messages: params.messages.map((m) => ({
        value: Buffer.from(m.value),
        key: m.key ? Buffer.from(m.key) : undefined,
      })),
    });
  }
}

class KafkaConsumerAdapter implements IKafkaConsumer {
  constructor(private consumer: Consumer) {}
  async subscribe(topic: string): Promise<void> {
    await this.consumer.subscribe({ topic, fromBeginning: false });
  }
  async run(config: KafkaConsumerRunConfig): Promise<void> {
    await this.consumer.run({
      autoCommit: config.autoCommit,
      eachMessage: async (payload) => {
        await config.eachMessage({
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          value: payload.message.value,
        });
      },
    });
  }
}

export class YKafkaRuntime {
  public io?: SocketIOServer;
  public kafkaProducer: Producer;
  public kafkaConsumer: Consumer; // For realtime broadcast
  public persistenceConsumer?: Consumer; // For persistence (if enabled)

  public roomRegistry: DefaultRoomRegistry;
  public topicResolver: DefaultTopicResolver;
  public persistenceCoordinator: PersistenceCoordinator;

  private isRunning = false;

  constructor(private config: YKafkaRuntimeConfig) {
    // 1. Initialize Kafka
    const kafka = new Kafka({
      logLevel: logLevel.ERROR,
      ...config.kafka.client,
    });
    this.kafkaProducer = kafka.producer(config.kafka.producer);
    this.kafkaConsumer = kafka.consumer(config.kafka.consumer);

    if (config.options?.enablePersistenceWorker !== false) {
      this.persistenceConsumer = kafka.consumer({
        ...config.kafka.consumer,
        groupId: `${config.kafka.consumer.groupId}-persistence`,
      });
    }

    // 2. Initialize Components
    this.roomRegistry = new DefaultRoomRegistry();
    this.topicResolver = new DefaultTopicResolver(config.kafka.topicTemplates);

    // 3. Initialize Persistence

    const persistenceAdapter = new TypeOrmPersistenceAdapter(
      config.database as any,
    );
    this.persistenceCoordinator = new PersistenceCoordinator(
      persistenceAdapter,
    );
  }

  /**
   * Attaches the YKafkaRuntime to an existing HTTP/HTTPS server.
   * This initializes Socket.IO and binds it to the server.
   */
  public attach(server: HttpServer | HttpsServer) {
    if (this.io) {
      throw new Error('Runtime is already attached to a server.');
    }

    let adapter;
    if (this.config.redis) {
      const redisConfig = this.config.redis;
      let pubClient: Redis;
      if (redisConfig.url) {
        pubClient = new Redis(redisConfig.url);
      } else {
        pubClient = new Redis({
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password,
        });
      }

      pubClient.on('error', (err) => {
        console.error('Redis Pub Client Error:', err);
      });

      const subClient = pubClient.duplicate();
      subClient.on('error', (err) => {
        console.error('Redis Sub Client Error:', err);
      });

      adapter = createAdapter(pubClient, subClient, {
        key: redisConfig.keyPrefix || 'y-kafka-collabation',
      });
    }

    this.io = new SocketIOServer(server, {
      ...this.config.socketIO,
      adapter,
      cors: this.config.socketIO?.cors || {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupSocketHandlers();
  }

  /**
   * Starts the runtime: connects to Kafka, DB, and starts consumers.
   */
  public async start() {
    if (this.isRunning) return;

    // Connect Producer
    await this.kafkaProducer.connect();

    // Start Realtime Broadcast Consumer
    if (this.config.options?.enableRealtimeWorker !== false) {
      const disableAwarenessConsumer = !!this.config.redis;
      await startKafkaConsumer({
        kafkaConsumer: new KafkaConsumerAdapter(this.kafkaConsumer),
        roomRegistry: this.roomRegistry,
        topicResolver: this.topicResolver,
        disableAwarenessConsumer,
      });
    }

    // Start Persistence Worker
    if (this.persistenceConsumer) {
      await this.startPersistenceWorker();
    }

    this.isRunning = true;
  }

  public async stop() {
    this.isRunning = false;
    await this.kafkaProducer.disconnect();
    await this.kafkaConsumer.disconnect();
    if (this.persistenceConsumer) {
      await this.persistenceConsumer.disconnect();
    }
    this.roomRegistry.dispose();
    this.io?.close();
  }

  private setupSocketHandlers() {
    if (!this.io) return;

    const transportHandlers = createSocketMessageTransportHandlers({
      kafkaProducer: new KafkaProducerAdapter(this.kafkaProducer),
      roomRegistry: this.roomRegistry,
      topicResolver: this.topicResolver,
      onAwarenessUpdate: this.config.redis
        ? async (socket, metadata, message) => {
            const event = getSocketIOEvent(Channel.Awareness);
            // Broadcast to all clients in the room except the sender
            socket.to(metadata.roomId).emit(event, message);
          }
        : undefined,
    });

    this.io.on('connection', async (socket: Socket) => {
      // 1. Extract Room/Doc Info from Query
      const query = socket.handshake.query;
      const roomId = (query.roomId as string) || (query.room as string);
      // If docId is not provided, use roomId (document-level granularity default)
      const docId = (query.docId as string) || roomId;

      if (!roomId) {
        console.warn('Socket connection rejected: Missing roomId');
        socket.disconnect();
        return;
      }

      const assignment: RoomAssignment = {
        roomId,
        docId,
        parentId: query.parentId as string,
      };

      // 2. Register Socket
      transportHandlers.handleConnection(socket, assignment);

      // 3. Hydrate Client (Load Snapshot)
      await this.hydrateClient(socket, assignment);

      // 4. Setup Message Handling
      // We listen to specific events defined in transport/types channel
      // Client sends events like 'y-kafka-collabation-server-sync'

      const channels = [Channel.Sync, Channel.Awareness, Channel.Control];

      channels.forEach((channel) => {
        socket.on(getSocketIOEvent(channel), async (data) => {
          await transportHandlers.handleClientMessage(socket, channel, data);
        });
      });

      socket.on('disconnect', () => {
        transportHandlers.handleDisconnect(socket);
      });
    });
  }

  private async hydrateClient(socket: Socket, assignment: RoomAssignment) {
    try {
      const { docId, parentId, roomId } = assignment;

      // 1. Recover Snapshot
      const snapshot = await this.persistenceCoordinator.recoverSnapshot(
        docId,
        roomId,
        parentId,
      );

      // 2. Recover subsequent updates (diffs)
      const sinceVersion = snapshot?.version;
      const updates = await this.persistenceCoordinator.getUpdatesSince(
        docId,
        roomId,
        parentId,
        sinceVersion,
      );

      const updatesToMerge: Uint8Array[] = [];
      let lastVersion = sinceVersion || '0';
      let lastTimestamp = snapshot?.timestamp || Date.now();

      if (snapshot) {
        updatesToMerge.push(snapshot.data);
      }

      if (updates && updates.length > 0) {
        updates.forEach((u) => {
          updatesToMerge.push(u.payload);
        });
        const lastUpdate = updates[updates.length - 1];
        if (lastUpdate) {
          lastVersion = lastUpdate.version;
          lastTimestamp = lastUpdate.timestamp;
        }
      }

      // 3. Merge and Send
      if (updatesToMerge.length > 0) {
        // Merge all updates into a single update using Ywasm (Rust-based)
        // This is significantly faster than JS implementation for large updates
        const mergedUpdate = mergeUpdatesV1(updatesToMerge);

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, ProtocolMessageType.Sync);
        encoding.writeVarUint(encoder, messageYjsSyncStep2);
        encoding.writeVarUint8Array(encoder, mergedUpdate);
        const payload = encoding.toUint8Array(encoder);

        const metadata = {
          roomId: assignment.roomId,
          docId: assignment.docId,
          parentId: assignment.parentId,
          timestamp: Number(lastTimestamp),
          senderId: 'server-hydration-merged',
          version: lastVersion,
        };
        const envelope = encodeEnvelope(payload, metadata);
        socket.emit(getSocketIOEvent(Channel.Sync), envelope);
      }
    } catch (err) {
      console.error('Failed to hydrate client:', err);
    }
  }

  private async startPersistenceWorker() {
    if (!this.persistenceConsumer) return;

    // We subscribe to all sync topics.
    // Since we use templates, we might need a wildcard subscription or known topics.
    // For simplicity with dynamic rooms, we typically use a regex pattern matching the prefix.

    // DefaultTopicResolver uses: `y-kafka-collabation-${channel}-${roomId}`
    const topicPattern = new RegExp(
      `^${this.topicResolver.prefix}-${Channel.Sync}-.*`,
    );

    await this.persistenceConsumer.subscribe({
      topic: topicPattern,
      fromBeginning: false,
    });

    await this.persistenceConsumer.run({
      autoCommit: true,
      eachMessage: async ({ message }) => {
        if (!message.value) return;

        try {
          const { metadata, payload } = decodeEnvelope(message.value);

          const decoder = decoding.createDecoder(payload);
          const messageType = decoding.readVarUint(decoder);

          if (messageType === ProtocolMessageType.Sync) {
            const syncType = decoding.readVarUint(decoder);
            if (
              syncType === messageYjsSyncStep2 ||
              syncType === 2 /* messageYjsUpdate */
            ) {
              const update = decoding.readVarUint8Array(decoder);

              const persistenceMeta: PersistenceMetadata = {
                docId: metadata.docId,
                version: String(message.offset),
                roomId: metadata.roomId,
                parentId: metadata.parentId,
                timestamp: metadata.timestamp,
              };

              // Persist Update
              await this.persistenceCoordinator.persistUpdate(
                persistenceMeta,
                Buffer.from(update),
              );
            }
          }
        } catch (e) {
          console.error('Persistence worker error:', e);
        }
      },
    });
  }
}

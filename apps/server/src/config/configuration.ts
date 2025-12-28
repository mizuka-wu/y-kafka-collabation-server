import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'yaml';
import type { RetryOptions } from 'kafkajs';

const DEFAULT_CONFIG_PATH = join(
  process.cwd(),
  'apps/server/config/server.config.yaml',
);

export type TopicTemplates = {
  sync: string;
  awareness: string;
  control?: string;
};

export type RoomPriority = Array<'roomId' | 'docId'>;

export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  consumerGroup: string;
  retry?: RetryOptions;
  topics: TopicTemplates;
  topicRoomPriority: RoomPriority;
}

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  synchronize: boolean;
  poolSize: number;
}

export interface StorageConfig {
  driver: 'local' | 'minio' | 's3' | 'oss' | string;
  basePath: string;
}

export interface AppConfig {
  kafka: KafkaConfig;
  mysql: MysqlConfig;
  storage: StorageConfig;
}

type RawConfig = Partial<{
  kafka: Partial<KafkaConfig & { topics: Partial<TopicTemplates> }>;
  mysql: Partial<MysqlConfig>;
  storage: Partial<StorageConfig>;
}>;

const defaultConfig: AppConfig = {
  kafka: {
    clientId: 'collab-server',
    brokers: ['localhost:9092'],
    consumerGroup: 'collab-server-sync',
    topics: {
      sync: 'sync-{roomId}',
      awareness: 'awareness-{roomId}',
      control: 'control-{roomId}',
    },
    topicRoomPriority: ['roomId', 'docId'],
  },
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'collab',
    synchronize: true,
    poolSize: 10,
  },
  storage: {
    driver: 'local',
    basePath: join(process.cwd(), 'dist', 'data'),
  },
};

const parseYamlFile = (path: string): RawConfig => {
  if (!existsSync(path)) {
    return {};
  }
  const payload = readFileSync(path, 'utf8');
  if (!payload.trim()) {
    return {};
  }
  try {
    return (yaml.parse(payload) as RawConfig) ?? {};
  } catch (error) {
    throw new Error(
      `Failed to parse config file ${path}: ${(error as Error).message}`,
    );
  }
};

const coerceNumber = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const configuration = (): AppConfig => {
  const path = DEFAULT_CONFIG_PATH;
  const raw = parseYamlFile(path);

  const kafkaTopics = {
    ...defaultConfig.kafka.topics,
    ...(raw.kafka?.topics ?? {}),
  } satisfies TopicTemplates;

  const kafka: KafkaConfig = {
    ...defaultConfig.kafka,
    ...raw.kafka,
    brokers: raw.kafka?.brokers ?? defaultConfig.kafka.brokers,
    topics: kafkaTopics,
    consumerGroup:
      raw.kafka?.consumerGroup ?? defaultConfig.kafka.consumerGroup,
    clientId: raw.kafka?.clientId ?? defaultConfig.kafka.clientId,
    topicRoomPriority:
      raw.kafka?.topicRoomPriority ?? defaultConfig.kafka.topicRoomPriority,
  };

  const mysql: MysqlConfig = {
    ...defaultConfig.mysql,
    ...raw.mysql,
    port: coerceNumber(raw.mysql?.port, defaultConfig.mysql.port),
    poolSize: coerceNumber(raw.mysql?.poolSize, defaultConfig.mysql.poolSize),
    synchronize:
      typeof raw.mysql?.synchronize === 'boolean'
        ? raw.mysql.synchronize
        : defaultConfig.mysql.synchronize,
  };

  const storage: StorageConfig = {
    ...defaultConfig.storage,
    ...raw.storage,
    basePath: raw.storage?.basePath ?? defaultConfig.storage.basePath,
    driver: raw.storage?.driver ?? defaultConfig.storage.driver,
  };

  return {
    kafka,
    mysql,
    storage,
  };
};

export type AppConfigSnapshot = ReturnType<typeof configuration>;

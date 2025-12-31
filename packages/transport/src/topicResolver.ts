import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import type { TopicResolver } from './types';

/**
 * Topic 模板定义：通过 `{roomId}`、`{docId}` 等占位符生成最终 topic。
 */
export type TopicTemplates = {
  sync: string;
  awareness: string;
  control?: string;
};

/**
 * 默认的 TopicResolver：基于模板生成 topic，并导出相应的订阅正则。
 */
export class DefaultTopicResolver implements TopicResolver {
  public prefix: string = 'y-kafka-collabation';
  /**
   * 根据前缀拼接 topic
   * 标准为 y-kafka-collabation-${channel}-${roomid}
   * @param channel - 带占位符的模板字符串
   * @param metadata - 消息元数据
   * @returns 替换占位符后的 topic 字符串
   */
  private generateTopicName(
    channel: string,
    metadata: ProtocolMessageMetadata,
  ) {
    const roomId = metadata.roomId;
    return `${this.prefix}-${channel}-${roomId}`;
  }

  constructor(private readonly templates: TopicTemplates) {}

  resolveSyncTopic(metadata: ProtocolMessageMetadata): string {
    return this.generateTopicName(this.templates.sync, metadata);
  }

  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string {
    return this.generateTopicName(this.templates.awareness, metadata);
  }

  resolveControlTopic(metadata: ProtocolMessageMetadata): string {
    const template = this.templates.control ?? 'control-{roomId}';
    return this.generateTopicName(template, metadata);
  }
}

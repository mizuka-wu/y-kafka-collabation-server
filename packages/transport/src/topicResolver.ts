import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import { type TopicResolver, type TopicResolverInput, Channel } from './types';

/**
 * Topic 模板定义：通过 `{roomId}`、`{docId}` 等占位符生成最终 topic。
 */
export type TopicTemplates = {
  [Channel.Sync]: string;
  [Channel.Awareness]: string;
  [Channel.Control]?: string;
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
   * @param input - 消息元数据 | roomId
   * @returns 替换占位符后的 topic 字符串
   */
  private generateTopicName(channel: string, input: TopicResolverInput) {
    const roomId = typeof input === 'string' ? input : input.roomId;
    return `${this.prefix}-${channel}-${roomId}`;
  }

  constructor(private readonly templates: TopicTemplates) {}

  resolveSyncTopic(input: TopicResolverInput): string {
    return this.generateTopicName(this.templates.sync, input);
  }

  resolveAwarenessTopic(input: TopicResolverInput): string {
    return this.generateTopicName(this.templates.awareness, input);
  }

  resolveControlTopic(input: ProtocolMessageMetadata): string {
    if (!this.templates.control)
      throw new Error('control topic template is not defined');
    return this.generateTopicName(this.templates.control, input);
  }

  parseChannelFromTopic(topic: string): Channel {
    return (topic.split('-')[1] ?? Channel.Sync) as Channel;
  }
}

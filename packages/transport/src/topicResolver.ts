import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import type { TopicResolver } from './types';

const PLACEHOLDER_REGEX = /\{(roomId|docId|tenantId)\}/g;
const ESCAPE_REGEX = /[-/\\^$*+?.()|[\]{}]/g;

export type TopicTemplates = {
  sync: string;
  awareness: string;
  control?: string;
};

export type RoomPriority = Array<'roomId' | 'docId'>;

const templateToRegex = (template: string): RegExp => {
  const escaped = template.replace(ESCAPE_REGEX, '\\$&');
  const pattern = escaped.replace(PLACEHOLDER_REGEX, '.+');
  return new RegExp(`^${pattern}$`);
};

const interpolateTemplate = (
  template: string,
  metadata: ProtocolMessageMetadata,
  roomSelector: () => string,
): string => {
  const replacements: Record<string, string | undefined> = {
    roomId: roomSelector(),
    docId: metadata.docId ?? metadata.roomId ?? 'unknown-doc',
    tenantId: metadata.note,
  };
  return template.replace(PLACEHOLDER_REGEX, (_match, key: string) => {
    const value = replacements[key];
    return value ?? `missing-${key}`;
  });
};

export class DefaultTopicResolver implements TopicResolver {
  public readonly syncTopicPattern?: RegExp;
  public readonly awarenessTopicPattern?: RegExp;
  public readonly controlTopicPattern?: RegExp;

  constructor(
    private readonly templates: TopicTemplates,
    private readonly roomPriority: RoomPriority,
  ) {
    if (this.templates.sync) {
      this.syncTopicPattern = templateToRegex(this.templates.sync);
    }
    if (this.templates.awareness) {
      this.awarenessTopicPattern = templateToRegex(this.templates.awareness);
    }
    if (this.templates.control) {
      this.controlTopicPattern = templateToRegex(this.templates.control);
    }
  }

  resolveSyncTopic(metadata: ProtocolMessageMetadata): string {
    return interpolateTemplate(this.templates.sync, metadata, () =>
      this.pickRoom(metadata),
    );
  }

  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string {
    return interpolateTemplate(this.templates.awareness, metadata, () =>
      this.pickRoom(metadata),
    );
  }

  resolveControlTopic(metadata: ProtocolMessageMetadata): string {
    const template = this.templates.control ?? 'control-{roomId}';
    return interpolateTemplate(template, metadata, () =>
      this.pickRoom(metadata),
    );
  }

  private pickRoom(metadata: ProtocolMessageMetadata): string {
    for (const field of this.roomPriority) {
      const value = metadata[field];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return metadata.roomId ?? metadata.docId ?? 'default';
  }
}

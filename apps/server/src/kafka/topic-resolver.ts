import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';
import { RoomPriority, TopicTemplates } from '../config/configuration';

export interface TopicResolver {
  readonly docTopicPattern: RegExp;
  readonly awarenessTopicPattern: RegExp;
  readonly controlTopicPattern?: RegExp;
  resolveDocTopic(metadata: ProtocolMessageMetadata): string;
  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string;
  resolveControlTopic?(metadata: ProtocolMessageMetadata): string;
}

const PLACEHOLDER_REGEX = /\{(roomId|docId|tenantId)\}/g;
const ESCAPE_REGEX = /[-/\\^$*+?.()|[\]{}]/g;

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

export class TemplateTopicResolver implements TopicResolver {
  public readonly docTopicPattern: RegExp;
  public readonly awarenessTopicPattern: RegExp;
  public readonly controlTopicPattern?: RegExp;

  constructor(
    private readonly templates: TopicTemplates,
    private readonly roomPriority: RoomPriority,
  ) {
    this.docTopicPattern = templateToRegex(this.templates.doc);
    this.awarenessTopicPattern = templateToRegex(this.templates.awareness);
    if (this.templates.control) {
      this.controlTopicPattern = templateToRegex(this.templates.control);
    }
  }

  resolveDocTopic(metadata: ProtocolMessageMetadata): string {
    return interpolateTemplate(this.templates.doc, metadata, () =>
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

import { ProtocolMessageMetadata } from '@y-kafka-collabation-server/protocol';

export interface TopicResolver {
  readonly docTopicPattern: RegExp;
  readonly awarenessTopicPattern: RegExp;
  readonly controlTopicPattern?: RegExp;
  resolveDocTopic(metadata: ProtocolMessageMetadata): string;
  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string;
  resolveControlTopic?(metadata: ProtocolMessageMetadata): string;
}

type EnvTemplates = {
  doc: string;
  awareness: string;
  control?: string;
};

const DEFAULT_TEMPLATES: EnvTemplates = {
  doc: 'docs-{roomId}',
  awareness: 'awareness-{roomId}',
  control: 'control-{roomId}',
};

const PLACEHOLDER_REGEX = /\{(roomId|docId|tenantId)\}/g;
const ESCAPE_REGEX = /[-/\\^$*+?.()|[\]{}]/g;

const interpolate = (
  template: string,
  metadata: ProtocolMessageMetadata,
): string => {
  const replacements: Record<string, string | undefined> = {
    roomId: metadata.roomId ?? metadata.docId ?? 'default',
    docId: metadata.docId ?? metadata.roomId ?? 'unknown-doc',
    tenantId: metadata.note,
  };
  return template.replace(PLACEHOLDER_REGEX, (_match, key: string) => {
    const value = replacements[key];
    return value ?? `missing-${key}`;
  });
};

const templateToRegex = (template: string): RegExp => {
  const escaped = template.replace(ESCAPE_REGEX, '\\$&');
  const pattern = escaped.replace(PLACEHOLDER_REGEX, '.+');
  return new RegExp(`^${pattern}$`);
};

export class EnvTopicResolver implements TopicResolver {
  private readonly templates: EnvTemplates;

  public readonly docTopicPattern: RegExp;
  public readonly awarenessTopicPattern: RegExp;
  public readonly controlTopicPattern?: RegExp;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.templates = {
      doc: env.KAFKA_DOC_TOPIC_TEMPLATE ?? DEFAULT_TEMPLATES.doc,
      awareness:
        env.KAFKA_AWARENESS_TOPIC_TEMPLATE ?? DEFAULT_TEMPLATES.awareness,
      control: env.KAFKA_CONTROL_TOPIC_TEMPLATE ?? DEFAULT_TEMPLATES.control,
    };

    this.docTopicPattern = templateToRegex(this.templates.doc);
    this.awarenessTopicPattern = templateToRegex(this.templates.awareness);
    if (this.templates.control) {
      this.controlTopicPattern = templateToRegex(this.templates.control);
    }
  }

  resolveDocTopic(metadata: ProtocolMessageMetadata): string {
    return interpolate(this.templates.doc, metadata);
  }

  resolveAwarenessTopic(metadata: ProtocolMessageMetadata): string {
    return interpolate(this.templates.awareness, metadata);
  }

  resolveControlTopic(metadata: ProtocolMessageMetadata): string {
    const template = this.templates.control ?? DEFAULT_TEMPLATES.control!;
    return interpolate(template, metadata);
  }
}

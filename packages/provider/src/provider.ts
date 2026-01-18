import { ProtocolManager } from './manager';
import { YDoc, Awareness } from 'ywasm';

export interface YKafkaCollabationProviderOptions {
  connect?: boolean;
  docId?: string;
  awareness?: Awareness;
  params?: { [key: string]: string };
  protocols?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WebSocketPolyfill?: any;
  resyncInterval?: number;
  maxBackoffTime?: number;
  disableBc?: boolean;
}

/**
 * YKafkaCollabationProvider is the main entry point for the Yjs provider.
 * It extends ProtocolManager which handles the core logic.
 * The constructor signature is aligned with y-websocket.
 */
export class YKafkaCollabationProvider extends ProtocolManager {
  /**
   * @param {string} serverUrl
   * @param {string} roomname
   * @param {YDoc} doc
   * @param {YKafkaCollabationProviderOptions} [options]
   */
  constructor(
    serverUrl: string,
    roomname: string,
    doc: YDoc,
    {
      connect = true,
      docId: optionDocId,
      awareness = new Awareness(doc),
      params = {},
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      protocols = [],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      WebSocketPolyfill = null,
      resyncInterval = -1,
      maxBackoffTime = 2500,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      disableBc = false,
    }: YKafkaCollabationProviderOptions = {},
  ) {
    let roomId = roomname;
    let docId = roomname;
    let explicitDocId = false;

    if (roomname.includes('/')) {
      const parts = roomname.split('/');
      roomId = parts[0] as string;
      docId = parts[parts.length - 1] as string;
      explicitDocId = true;
    }

    if (!explicitDocId) {
      if (optionDocId) {
        docId = optionDocId;
      } else if (params) {
        const paramDocId =
          params.docId || params.docid || params['doc-id'] || params.id;
        if (paramDocId) {
          docId = paramDocId;
        }
      }
    }

    super({
      url: serverUrl,
      roomId,
      params,
      autoConnect: connect,
      resyncInterval: resyncInterval > 0 ? resyncInterval : undefined,
      socketOptions: {
        reconnectionDelayMax: maxBackoffTime,
      },
    });

    this.addDoc(doc, { docId, awareness });
  }
}

import { io, Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
import { decodeKafkaEnvelope } from '@y-kafka-collabation-server/protocol';
import { Buffer } from 'buffer';

const toUint8Array = (
  payload: string | ArrayBuffer | ArrayBufferView | Uint8Array,
): Uint8Array => {
  if (typeof payload === 'string') {
    const encoder = new TextEncoder();
    return encoder.encode(payload);
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
};

const toBase64 = (buf: Uint8Array) => {
  return Buffer.from(buf).toString('base64');
};

const fromBase64 = (value: string) => {
  return Buffer.from(value, 'base64');
};

export class MultiplexedSocketManager {
  private socket: Socket;
  private virtualSockets = new Map<string, VirtualWebSocket>();

  constructor(url: string, opts?: Partial<ManagerOptions & SocketOptions>) {
    this.socket = io(url, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      forceNew: true,
      ...opts,
    });

    this.socket.on('connect', () => {
      // Re-join all rooms
      for (const docId of this.virtualSockets.keys()) {
        this.socket.emit('join', { docId });
      }
      // Notify all virtual sockets
      for (const vSocket of this.virtualSockets.values()) {
        vSocket.notifyOpen();
      }
    });

    this.socket.on('disconnect', (reason: Socket.DisconnectReason) => {
      for (const vSocket of this.virtualSockets.values()) {
        vSocket.notifyClose(reason);
      }
    });

    this.socket.on('connect_error', (error: Error) => {
      for (const vSocket of this.virtualSockets.values()) {
        vSocket.notifyError(error);
      }
    });

    this.socket.on(
      'protocol-message',
      ({ docId, payload }: { docId: string; payload: string }) => {
        const vSocket = this.virtualSockets.get(docId);
        if (vSocket) {
          vSocket.deliverMessage(payload);
        }
      },
    );
  }

  register(docId: string, vSocket: VirtualWebSocket) {
    this.virtualSockets.set(docId, vSocket);
    if (this.socket.connected) {
      this.socket.emit('join', { docId });
      // Defer open event to allow listeners to be attached
      setTimeout(() => vSocket.notifyOpen(), 0);
    }
  }

  unregister(docId: string) {
    this.virtualSockets.delete(docId);
  }

  send(docId: string, roomId: string, payload: string) {
    this.socket.emit('protocol-message', { docId, roomId, payload });
  }

  connect() {
    this.socket.connect();
  }

  disconnect() {
    this.socket.disconnect();
  }
}

export class VirtualWebSocket implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSING = 2;
  public readonly CLOSED = 3;

  public readyState = VirtualWebSocket.CONNECTING;
  public bufferedAmount = 0;
  public binaryType: BinaryType = 'arraybuffer';
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<Uint8Array>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  public readonly url: string;
  private docId: string;

  constructor(
    private manager: MultiplexedSocketManager,
    url: string,
  ) {
    this.url = url;
    // Extract docId from url "virtual://<docId>"
    const match = url.match(/virtual:\/\/(.+)/);
    if (!match) {
      throw new Error(
        'Invalid VirtualWebSocket URL. Expected virtual://<docId>',
      );
    }
    this.docId = match[1] as string;

    // Register immediately
    this.manager.register(this.docId, this);
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Uint8Array): void {
    if (this.readyState !== VirtualWebSocket.OPEN) {
      console.warn('VirtualWebSocket is not open, dropping message');
      return;
    }
    const buffer = toUint8Array(data);
    let roomId = 'default';
    try {
      const { metadata } = decodeKafkaEnvelope(buffer);
      roomId = metadata.roomId;
    } catch (_e) {
      // ignore
    }
    const payload = toBase64(buffer);
    this.manager.send(this.docId, roomId, payload);
  }

  close(code?: number, reason?: string): void {
    this.readyState = VirtualWebSocket.CLOSED;
    this.manager.unregister(this.docId);
    this.onclose?.(
      new CloseEvent('close', {
        code: code ?? 1000,
        reason: reason ?? 'closed by client',
        wasClean: true,
      }),
    );
  }

  // --- Internal methods called by Manager ---

  notifyOpen() {
    if (this.readyState === VirtualWebSocket.OPEN) return;
    this.readyState = VirtualWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  notifyClose(reason: string) {
    if (this.readyState === VirtualWebSocket.CLOSED) return;
    this.readyState = VirtualWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent('close', {
        code: 1006,
        reason,
        wasClean: false,
      }),
    );
  }

  notifyError(_error: unknown) {
    this.onerror?.(new Event('error'));
  }

  deliverMessage(payload: string) {
    const buffer = fromBase64(payload);
    this.onmessage?.(new MessageEvent('message', { data: buffer }));
  }

  // --- Stubs ---
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  get extensions() {
    return '';
  }
  get protocol() {
    return '';
  }
}

export const createVirtualWebSocketFactory = (
  manager: MultiplexedSocketManager,
) => {
  return class extends VirtualWebSocket {
    constructor(url: string) {
      super(manager, url);
    }
  } as any as typeof WebSocket;
};

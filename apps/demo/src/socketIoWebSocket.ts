import { io, Socket } from 'socket.io-client';
import { decodeKafkaEnvelope } from '@y-kafka-collabation-server/protocol';

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

const toBase64 = (buffer: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const chunk = buffer.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = window.atob(value);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
};

type ProtocolUpdate = {
  docId?: string;
  payload: string;
};

export class SocketIoWebSocket implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  public readonly CONNECTING = 0;
  public readonly OPEN = 1;
  public readonly CLOSING = 2;
  public readonly CLOSED = 3;

  public readyState = SocketIoWebSocket.CONNECTING;
  public bufferedAmount = 0;
  public readonly url: string;
  public binaryType: BinaryType = 'arraybuffer';
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<Uint8Array>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  private socket: Socket;

  constructor(url: string | URL, protocols?: string | string[]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _p = protocols;
    const urlStr = url.toString();
    this.socket = io(urlStr, {
      transports: ['websocket'],
      autoConnect: true,
    });
    this.url = urlStr;

    this.socket.on('connect', () => {
      this.readyState = SocketIoWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });

    this.socket.on('protocol-message', ({ payload }: ProtocolUpdate) => {
      const buffer = fromBase64(payload);
      this.onmessage?.(new MessageEvent('message', { data: buffer }));
    });

    this.socket.on('disconnect', (reason: string) => {
      this.readyState = SocketIoWebSocket.CLOSED;
      this.onclose?.(
        new CloseEvent('close', { reason, wasClean: true, code: 1000 }),
      );
    });

    this.socket.on('connect_error', (error: Error) => {
      this.onerror?.(new Event('error'));
      console.error('Socket.IO connect error', error);
    });
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Uint8Array): void {
    if (this.readyState !== SocketIoWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    const buffer = toUint8Array(data);
    let docId: string | undefined;
    let roomId: string | undefined;
    try {
      const { metadata } = decodeKafkaEnvelope(buffer);
      docId = metadata.docId;
      roomId = metadata.roomId;
    } catch (error) {
      console.error('无法解析 Kafka envelope metadata', error);
    }
    const payload = toBase64(buffer);
    this.socket.emit('protocol-message', { docId, roomId, payload });
  }

  close(code?: number, reason?: string): void {
    if (
      this.readyState === SocketIoWebSocket.CLOSING ||
      this.readyState === SocketIoWebSocket.CLOSED
    ) {
      return;
    }
    this.readyState = SocketIoWebSocket.CLOSING;
    this.socket.disconnect();
    this.readyState = SocketIoWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent('close', {
        code: code ?? 1000,
        reason: reason ?? 'client',
        wasClean: true,
      }),
    );
  }

  addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {}

  removeEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions,
  ): void {}

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  get extensions(): string {
    return '';
  }

  get protocol(): string {
    return '';
  }
}

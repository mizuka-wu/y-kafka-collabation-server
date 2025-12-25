type MessagePayload = ArrayBuffer | ArrayBufferView | Blob | string;

export class MockWebSocket {
  static onCreate?: (socket: MockWebSocket) => void;

  public binaryType = 'arraybuffer' as const;
  public onopen?: () => void;
  public onmessage?: (event: { data: ArrayBuffer | string }) => void;
  public onclose?: () => void;
  public onerror?: (event: unknown) => void;

  public readonly sent: Uint8Array[] = [];

  constructor(public readonly url: string) {
    setTimeout(() => {
      this.onopen?.();
    }, 0);
    MockWebSocket.onCreate?.(this);
  }

  send(payload: MessagePayload): void {
    const buffer = this.toUint8Array(payload);
    this.sent.push(buffer);
  }

  close(): void {
    this.onclose?.();
  }

  simulateServerMessage(payload: Uint8Array): void {
    if (!this.onmessage) {
      return;
    }
    const buffer = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    );
    this.onmessage({ data: buffer });
  }

  private toUint8Array(data: MessagePayload): Uint8Array {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (
      typeof (data as ArrayBufferView).buffer !== 'undefined' &&
      data instanceof Uint8Array
    ) {
      return data;
    }
    if (data instanceof Blob) {
      throw new Error('Blob payloads are not supported in demo mock');
    }
    return new Uint8Array((data as ArrayBufferView).buffer);
  }
}

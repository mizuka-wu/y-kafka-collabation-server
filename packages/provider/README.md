# @y-kafka-collabation-server/provider

A high-performance Yjs provider client for `y-kafka-collabation-server`. It implements a layered architecture to handle connection, protocol processing, and document state management with support for **Multiplexing** and **Kafka Offsets**.

Powered by `ywasm` for near-native performance.

## Features

- **Multiplexing**: Manage multiple `YDoc` instances over a single Socket.IO connection.
- **Kafka Offsets**: Tracks Kafka offsets for every message to ensure strict ordering and consistency.
- **High Performance**: Uses `ywasm` (WASM implementation of Yjs) for critical operations (Sync, Awareness).
- **Layered Architecture**: Separation of concerns between Transport, Protocol, and State management.
- **Type-Safe**: Full TypeScript support with typed events.

## Architecture

The provider is built with a 3-layer architecture:

1. **Connection Layer (`ProtocolConnection`)**
    - Manages the `Socket.IO` client connection.
    - Handles raw message envelopes (Metadata + Payload).
    - Extracts `offset` (Kafka offset) from incoming messages.
    - Emits typed events (`message-sync`, `message-awareness`, etc.).

2. **Processing Layer (`ProtocolProcessing`)**
    - Extends `ProtocolConnection`.
    - Implements the Yjs protocol logic (Sync, Awareness, Auth, Control).
    - Uses `ywasm` native functions (`applyUpdate`, `encodeStateAsUpdate`) for zero-overhead processing.
    - Updates `DocState` with the latest received Kafka offset.

3. **Manager Layer (`ProtocolManager`)**
    - Extends `ProtocolProcessing`.
    - Manages the lifecycle of multiple `Y.Doc` instances.
    - Uses a `Map<string, DocState>` to route messages to the correct document.
    - Uses a `WeakMap<YDoc, DocState>` to track metadata (synced state, offsets) without leaking memory.

## Data Flow

### Inbound (Server -> Client)

1. **Socket.IO** receives a binary message.
2. **`ProtocolConnection`** decodes the envelope, extracting:
    - `messageType` (Sync, Awareness, etc.)
    - `docId` (Target document)
    - `offset` (Kafka offset)
3. **`ProtocolProcessing`** handles the specific protocol message:
    - **Sync**: Applies updates to the `YDoc` using `ywasm`.
    - **Awareness**: Updates awareness states.
4. **`ProtocolManager`** ensures the update is applied to the correct `YDoc` instance found via `docId`.

### Outbound (Client -> Server)

1. **`YDoc`** triggers an `update` event on local changes.
2. **`ProtocolManager`** (via `updateHandler`) captures the update.
3. **`ProtocolConnection`** wraps the update in a protocol envelope.
4. **Socket.IO** emits the binary message to the server.

## Usage

```typescript
import { ProtocolManager } from '@y-kafka-collabation-server/provider';
import { YDoc } from 'ywasm';

// 1. Initialize the manager
const provider = new ProtocolManager({
  url: 'ws://localhost:3000',
  roomId: 'my-room-id',
  autoConnect: true,
});

// 2. Create a YDoc (ywasm)
const doc = new YDoc();

// 3. Add the doc to the provider (Multiplexing)
// The docId is used to route messages.
provider.addDoc(doc, { docId: 'my-document-guid' });

// 4. Listen to events
provider.on('synced', ({ docId, state }) => {
  console.log(`Document ${docId} synced: ${state}`);
});

provider.on('status', ({ status }) => {
  console.log('Connection status:', status);
});

// 5. Cleanup
// provider.removeDoc(doc);
// provider.destroy();
```

## API

### `ProtocolManager`

#### Constructor

`new ProtocolManager(options: ProtocolProviderOptions)`

#### Methods

- `addDoc(doc: YDoc, options?: { docId?: string; parentId?: string })`: Register a doc.
- `removeDoc(doc: YDoc)`: Unregister a doc.
- `destroy()`: Close connection and cleanup.

#### Events

- `status`: Connection status changes.
- `synced`: Document sync state changes.
- `permission-denied`: Auth failures.
- `connection-error`: Socket errors.

## Dependencies

- `ywasm`: WASM implementation of CRDT.
- `socket.io-client`: Transport layer.
- `@y-kafka-collabation-server/protocol`: Shared protocol definitions.

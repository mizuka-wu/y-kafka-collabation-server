import React, { useEffect, useRef, useState } from 'react';
import { DocCollection } from '@blocksuite/store';
import { AffineSchemas } from '@blocksuite/blocks/schemas';
import { AffineEditorContainer } from '@blocksuite/presets';
import { ProtocolProvider } from '@y-kafka-collabation-server/provider';
import * as Y from '@y/y';
import {
  getMultiplexedSocketFactory,
  disconnectMultiplexedSocket,
} from '../lib/multiplexedSocket';

// Import blocksuite styles
import '@blocksuite/presets/themes/affine.css';

const VITE_COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL ?? 'http://localhost:3000';

export const BlockSuiteDemo = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collection, setCollection] = useState<DocCollection | null>(null);

  // Track providers to destroy them on cleanup
  const providersRef = useRef<Map<string, ProtocolProvider>>(new Map());

  useEffect(() => {
    // 1. Initialize DocCollection
    const col = new DocCollection({
      schema: AffineSchemas,
      id: 'blocksuite-demo-collection',
    });

    // 2. Initialize Editor
    const editorContainer = new AffineEditorContainer();
    editorContainer.doc = col.createDoc({ id: 'page:home' });
    col.start();

    setCollection(col);

    // Mount editor
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(editorContainer);
    }

    return () => {
      editorContainer.remove();
      col.dispose(); // Stops the collection
    };
  }, []);

  // 3. Connect Providers
  useEffect(() => {
    if (!collection) return;

    // Get the socket factory for the server URL
    // We use one socket connection for all docs (main + subdocs)
    const socketUrl = `${VITE_COLLAB_SERVER_URL}/socket.io/`;
    const WebSocketFactory = getMultiplexedSocketFactory(socketUrl);

    const connectDoc = (doc: Y.Doc) => {
      if (providersRef.current.has(doc.guid)) return;

      const provider = new ProtocolProvider(doc, {
        // Virtual URL maps to the docId in MultiplexedSocketManager
        url: `virtual://${doc.guid}`,
        roomId: 'blocksuite', // Use a specific room for BlockSuite demo
        docId: doc.guid,
        WebSocketImpl: WebSocketFactory,
        autoConnect: true,
      });

      providersRef.current.set(doc.guid, provider);

      provider.on('status', (status) => {
        console.log(`[${doc.guid}] status:`, status);
      });
    };

    // Connect existing docs
    collection.docs.forEach((doc) => connectDoc(doc.spaceDoc));

    // Listen for new docs (subdocs)
    const dispose = collection.slots.docCreated.on((doc) => {
      connectDoc(doc.spaceDoc);
    });

    return () => {
      dispose.dispose();
      providersRef.current.forEach((p) => p.destroy());
      providersRef.current.clear();
      disconnectMultiplexedSocket();
    };
  }, [collection]);

  return (
    <div
      className="demo-page"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <header className="page-header" style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2>BlockSuite Demo</h2>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            支持 Subdocs · 使用 Socket.IO Multiplexing
          </div>
        </div>
      </header>

      <div
        ref={containerRef}
        className="blocksuite-container"
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: '#fff',
          borderRadius: '8px',
          border: '1px solid var(--border)',
        }}
      />
    </div>
  );
};

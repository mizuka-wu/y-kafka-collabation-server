export type ServerStatus = {
  docId: string;
  kafkaMessageCount: number;
  latestSnapshot: string | null;
};

export type KafkaTail = {
  topic: string;
  partition: number;
  offset: string;
};

export type DocumentState = {
  docId: string;
  snapshot: string | null;
  updates: string[];
  kafkaUpdates: string[];
  kafkaTail?: KafkaTail | null;
};

export const fetchStatus = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/collab/status`);
  if (!response.ok) {
    throw new Error('状态请求失败');
  }
  return (await response.json()) as ServerStatus[];
};

export const fetchDocumentState = async (baseUrl: string, docId: string) => {
  const response = await fetch(`${baseUrl}/collab/doc/${docId}`);
  if (!response.ok) {
    throw new Error('文档状态请求失败');
  }
  return (await response.json()) as DocumentState;
};

export const publishUpdate = async (
  baseUrl: string,
  roomId: string,
  docId: string,
  content: string,
  channel: 'doc' | 'awareness' | 'control' = 'doc',
) => {
  const response = await fetch(`${baseUrl}/collab/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roomId, docId, content, channel }),
  });
  if (!response.ok) {
    throw new Error('更新推送失败');
  }
};

export const persistSnapshot = async (
  baseUrl: string,
  docId: string,
  snapshot: string,
  version: string,
  subdocId?: string,
  timestamp?: number,
) => {
  await fetch(`${baseUrl}/collab/persist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ docId, snapshot, version, subdocId, timestamp }),
  });
};

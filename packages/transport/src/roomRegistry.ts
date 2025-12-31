import mitt, { type Emitter } from 'mitt';
import type { Socket } from 'socket.io';
import type { RoomAssignment, RoomPresenceChange, RoomRegistry } from './types';

/**
 * 房间注册表，用于管理 Socket 与房间/子文档的映射关系
 *
 * 该实现会定期清理断开连接的 Socket，避免内存泄漏
 *
 * @remarks
 * - 使用 Map 存储 Socket 到房间/子文档的映射
 * - 维护房间和子文档的反向索引，便于快速查找
 * - 定期清理断开连接的 Socket，防止内存泄漏
 */
export class DefaultRoomRegistry implements RoomRegistry {
  /** Socket 到房间/子文档分配的映射 */
  private socketAssignments = new Map<Socket, RoomAssignment>();
  /** roomId → sockets，对应整房广播（控制/运维场景）。 */
  private roomIndex = new Map<string, Set<Socket>>();
  /** roomId + docId → sockets，定位主文档。 */
  private docIndex = new Map<string, Set<Socket>>();
  /** roomId + docId + subdocId → sockets，定位子文档。 */
  private subdocIndex = new Map<string, Set<Socket>>();
  /** 房间事件 emitter */
  private emitter: Emitter<{
    'room-change': RoomPresenceChange;
  }> = mitt();

  /** 定期清理断开连接的 Socket 的定时器 */
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly cleanupIntervalMs: number = 30000) {
    this.scheduleCleanup();
  }

  /**
   * 回调注册
   * @param listener
   * @returns
   */
  onRoomChange(listener: (change: RoomPresenceChange) => void): () => void {
    this.emitter.on('room-change', listener);
    return () => {
      this.emitter.off('room-change', listener);
    };
  }

  /**
   * 添加 Socket 到房间/子文档的映射
   * @param socket Socket 实例
   * @param assignment 房间/子文档分配信息
   */
  add(socket: Socket, assignment: RoomAssignment): void {
    this.remove(socket);
    this.socketAssignments.set(socket, assignment);

    const roomId = assignment.roomId;
    const existingRoomSet = this.roomIndex.get(roomId);
    const wasEmpty = !existingRoomSet || existingRoomSet.size === 0;

    const roomSet = this.getIndexSet(this.roomIndex, roomId);
    roomSet.add(socket);

    if (wasEmpty) {
      this.emitRoomChange({ type: 'added', roomId });
    }

    const docKey = this.getDocKey(assignment.roomId, assignment.docId);
    const docSet = this.getIndexSet(this.docIndex, docKey);
    docSet.add(socket);

    if (assignment.subdocId) {
      const subKey = this.getSubdocKey(
        assignment.roomId,
        assignment.docId,
        assignment.subdocId,
      );
      const subSet = this.getIndexSet(this.subdocIndex, subKey);
      subSet.add(socket);
    }
  }

  remove(socket: Socket): void {
    const assignment = this.socketAssignments.get(socket);
    if (!assignment) {
      return;
    }
    this.socketAssignments.delete(socket);

    const roomRemoved = this.deleteFromIndex(
      this.roomIndex,
      assignment.roomId,
      socket,
    );

    if (roomRemoved) {
      this.emitRoomChange({ type: 'removed', roomId: assignment.roomId });
    }

    const docKey = this.getDocKey(assignment.roomId, assignment.docId);
    this.deleteFromIndex(this.docIndex, docKey, socket);

    if (assignment.subdocId) {
      const subKey = this.getSubdocKey(
        assignment.roomId,
        assignment.docId,
        assignment.subdocId,
      );
      this.deleteFromIndex(this.subdocIndex, subKey, socket);
    }
  }

  getSockets(roomId: string, docId?: string, subdocId?: string): Socket[] {
    if (docId && subdocId) {
      const subKey = this.getSubdocKey(roomId, docId, subdocId);
      return Array.from(this.subdocIndex.get(subKey) ?? []);
    }
    if (docId) {
      const docKey = this.getDocKey(roomId, docId);
      return Array.from(this.docIndex.get(docKey) ?? []);
    }
    return Array.from(this.roomIndex.get(roomId) ?? []);
  }

  getRooms(): string[] {
    return Array.from(this.roomIndex.keys());
  }

  private getDocKey(roomId: string, docId: string): string {
    return `${roomId}::${docId}`;
  }

  private getSubdocKey(
    roomId: string,
    docId: string,
    subdocId: string,
  ): string {
    return `${roomId}::${docId}::${subdocId}`;
  }

  private getIndexSet(
    index: Map<string, Set<Socket>>,
    key: string,
  ): Set<Socket> {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    return set;
  }

  private deleteFromIndex(
    index: Map<string, Set<Socket>>,
    key: string,
    socket: Socket,
  ): boolean {
    const set = index.get(key);
    if (!set) {
      return false;
    }
    set.delete(socket);
    if (set.size === 0) {
      index.delete(key);
      return true;
    }
    return false;
  }

  prune(): void {
    for (const [socket] of this.socketAssignments) {
      if (!socket.connected) {
        this.remove(socket);
      }
    }
    this.scheduleCleanup();
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      this.prune();
    }, this.cleanupIntervalMs);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }
    this.socketAssignments.clear();
    this.roomIndex.clear();
    this.docIndex.clear();
    this.subdocIndex.clear();

    this.emitter.all.clear();
  }

  private emitRoomChange(change: RoomPresenceChange): void {
    this.emitter.emit('room-change', change);
  }
}

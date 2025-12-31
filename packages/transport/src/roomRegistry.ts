import type { Socket } from 'socket.io';
import type { RoomAssignment, RoomRegistry } from './types';

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
  /** 房间 ID 到 Socket 集合的映射 */
  private roomIndex = new Map<string, Set<Socket>>();
  /** 子文档 ID 到 Socket 集合的映射 */
  private subdocIndex = new Map<string, Set<Socket>>();

  /** 定期清理断开连接的 Socket 的定时器 */
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly cleanupIntervalMs: number = 30000) {
    this.scheduleCleanup();
  }

  /**
   * 添加 Socket 到房间/子文档的映射
   * @param socket Socket 实例
   * @param assignment 房间/子文档分配信息
   */
  add(socket: Socket, assignment: RoomAssignment): void {
    this.remove(socket);
    this.socketAssignments.set(socket, assignment);

    let roomSet = this.roomIndex.get(assignment.roomId);
    if (!roomSet) {
      roomSet = new Set();
      this.roomIndex.set(assignment.roomId, roomSet);
    }
    roomSet.add(socket);

    if (assignment.subdocId) {
      const subKey = this.getSubdocKey(assignment.roomId, assignment.subdocId);
      let subSet = this.subdocIndex.get(subKey);
      if (!subSet) {
        subSet = new Set();
        this.subdocIndex.set(subKey, subSet);
      }
      subSet.add(socket);
    }
  }

  remove(socket: Socket): void {
    const assignment = this.socketAssignments.get(socket);
    if (!assignment) {
      return;
    }
    this.socketAssignments.delete(socket);

    const roomSet = this.roomIndex.get(assignment.roomId);
    roomSet?.delete(socket);
    if (roomSet && roomSet.size === 0) {
      this.roomIndex.delete(assignment.roomId);
    }

    if (assignment.subdocId) {
      const subKey = this.getSubdocKey(assignment.roomId, assignment.subdocId);
      const subSet = this.subdocIndex.get(subKey);
      subSet?.delete(socket);
      if (subSet && subSet.size === 0) {
        this.subdocIndex.delete(subKey);
      }
    }
  }

  getSockets(roomId: string, subdocId?: string): Socket[] {
    if (subdocId) {
      const subKey = this.getSubdocKey(roomId, subdocId);
      return Array.from(this.subdocIndex.get(subKey) ?? []);
    }
    return Array.from(this.roomIndex.get(roomId) ?? []);
  }

  private getSubdocKey(roomId: string, subdocId: string): string {
    return `${roomId}::${subdocId}`;
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
    this.subdocIndex.clear();
  }
}

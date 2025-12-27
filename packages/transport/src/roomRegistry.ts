import type { Socket } from 'socket.io';
import type { RoomAssignment, RoomRegistry } from './types';

export class DefaultRoomRegistry implements RoomRegistry {
  private socketAssignments = new Map<Socket, RoomAssignment>();
  private roomIndex = new Map<string, Set<Socket>>();
  private subdocIndex = new Map<string, Set<Socket>>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly cleanupIntervalMs: number = 30000) {
    this.cleanupInterval = setInterval(() => {
      this.prune();
    }, this.cleanupIntervalMs);
  }

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
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.socketAssignments.clear();
    this.roomIndex.clear();
    this.subdocIndex.clear();
  }
}

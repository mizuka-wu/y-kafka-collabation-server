export class SnowflakeIdGenerator {
  private workerId: bigint;
  private datacenterId: bigint;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = -1n;

  private workerIdBits: bigint = 5n;
  private datacenterIdBits: bigint = 5n;
  private sequenceBits: bigint = 12n;

  private maxWorkerId: bigint = -1n ^ (-1n << this.workerIdBits);
  private maxDatacenterId: bigint = -1n ^ (-1n << this.datacenterIdBits);

  private workerIdShift: bigint = this.sequenceBits;
  private datacenterIdShift: bigint = this.sequenceBits + this.workerIdBits;
  private timestampLeftShift: bigint =
    this.sequenceBits + this.workerIdBits + this.datacenterIdBits;

  private sequenceMask: bigint = -1n ^ (-1n << this.sequenceBits);
  private epoch: bigint;

  constructor(
    workerId: number,
    datacenterId: number,
    epoch: number = 1672531200000,
  ) {
    // Default epoch: 2023-01-01
    this.workerId = BigInt(workerId);
    this.datacenterId = BigInt(datacenterId);
    this.epoch = BigInt(epoch);

    if (this.workerId > this.maxWorkerId || this.workerId < 0n) {
      throw new Error(
        `worker Id can't be greater than ${this.maxWorkerId} or less than 0`,
      );
    }
    if (this.datacenterId > this.maxDatacenterId || this.datacenterId < 0n) {
      throw new Error(
        `datacenter Id can't be greater than ${this.maxDatacenterId} or less than 0`,
      );
    }
  }

  nextId(): string {
    let timestamp = this.timeGen();

    if (timestamp < this.lastTimestamp) {
      throw new Error(
        `Clock moved backwards. Refusing to generate id for ${
          this.lastTimestamp - timestamp
        } milliseconds`,
      );
    }

    if (this.lastTimestamp === timestamp) {
      this.sequence = (this.sequence + 1n) & this.sequenceMask;
      if (this.sequence === 0n) {
        timestamp = this.tilNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      ((timestamp - this.epoch) << this.timestampLeftShift) |
      (this.datacenterId << this.datacenterIdShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence;

    return id.toString();
  }

  private tilNextMillis(lastTimestamp: bigint): bigint {
    let timestamp = this.timeGen();
    while (timestamp <= lastTimestamp) {
      timestamp = this.timeGen();
    }
    return timestamp;
  }

  private timeGen(): bigint {
    return BigInt(Date.now());
  }
}

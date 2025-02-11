import Redis, { Cluster } from 'ioredis';

class ExtendedClusterRedis extends Cluster {

  async clusterPipeline(commands: [string, ...any][]): Promise<any[]> {
    const pipelinesByNode: Record<string, { commands: any[][], originalIndices: number[] }> = {};
    const clusterSlots = await this.cluster('SHARDS') as [string, [number, number][], string, [string, string]][];
    const nodeSlotRanges = clusterSlots.flatMap(([, slotRanges, , [node]]) => {
      // slotRanges can contain multiple start-end pairs
      const ranges = [];
      for (let i = 0; i < slotRanges.length; i += 2) {
        ranges.push({
          node: node[1],
          startSlot: slotRanges[i],
          endSlot: slotRanges[i + 1],
        });
      }
      return ranges;
    });

    // Group commands by node
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const key = command[1];
      const slot = this.calculateSlot(key);
      const node = this.findNodeForSlot(nodeSlotRanges, slot);
      if (!pipelinesByNode[node]) {
        pipelinesByNode[node] = { commands: [], originalIndices: [] };
      }
      pipelinesByNode[node].commands.push(command);
      pipelinesByNode[node].originalIndices.push(i);
    }

    // Execute pipelines per node
    const results = [];
    for (const node in pipelinesByNode) {
      const { commands, originalIndices } = pipelinesByNode[node];
      const pipeline = this.pipeline();
      commands.forEach(cmd => pipeline[cmd[0]](...cmd.slice(1)));
      const nodeResult = await pipeline.exec();
      nodeResult.forEach((result, localIndex) => {
        const originalIndex = originalIndices[localIndex];
        results[originalIndex] = result;
      });
    }

    return results;
  }

  private calculateSlot(key: string): number {
    if (key == null) {
      return 0;
    }
    key = String(key);

    // Handle hash tag (keys inside {})
    const hashTagMatch = key.match(/\{(.+?)\}/);
    if (hashTagMatch) {
      key = hashTagMatch[1];
    }
    if (key.trim().length === 0) {
      return 0;
    }
    return this.hashCRC16(key) % 16384;
  }

  private hashCRC16(str: string) {
    let crc = 0;
    const polynomial = 0x1021;
    const buffer = Buffer.from(str, 'utf8');

    for (let byte of buffer) {
      crc ^= byte << 8;

      for (let i = 0; i < 8; i++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ polynomial;
        } else {
          crc <<= 1;
        }
        crc &= 0xFFFF;
      }
    }
    return crc;
  }

  private findNodeForSlot(nodeSlotRanges: { node: string, startSlot: number, endSlot: number }[], slot: number) {
    const matchingRange = nodeSlotRanges.find(
      range => slot >= range.startSlot && slot <= range.endSlot
    );
    return matchingRange ? matchingRange.node : null;
  }
}

export { Redis, ExtendedClusterRedis as Cluster };
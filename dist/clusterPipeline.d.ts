import Redis, { Cluster } from 'ioredis';
declare class ExtendedClusterRedis extends Cluster {
    private nodeSlotRanges;
    private updateRedisClusterSlots;
    clusterPipeline(commands: [string, ...any][]): Promise<[error: Error | null, result: unknown][] | null>;
    private executePipelineForCluster;
    private calculateSlot;
    private hashCRC16;
    private findNodeForSlot;
}
export { Redis, ExtendedClusterRedis as Cluster };

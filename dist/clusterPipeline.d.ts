import Redis, { Cluster } from 'ioredis';
declare class ExtendedClusterRedis extends Cluster {
    clusterPipeline(commands: [string, ...any][]): Promise<any[]>;
    private calculateSlot;
    private hashCRC16;
    private findNodeForSlot;
}
export { Redis, ExtendedClusterRedis as Cluster };

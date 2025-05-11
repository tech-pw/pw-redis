import Redis, { Cluster } from 'ioredis';
/**
 * Extended Redis Cluster class that handles pipeline operations more efficiently.
 * Specifically handles cases where commands need to be redirected due to:
 * 1. Cluster resharding/rebalancing
 * 2. Master-replica failover
 * 3. Slot migration between nodes
 * 4. Adding/removing nodes from cluster
 */
declare class ExtendedClusterRedis extends Cluster {
    /**
     * Executes multiple Redis commands in a pipeline across cluster nodes
     * @param commands Array of Redis commands to execute
     * @returns Array of [error, result] pairs matching the input command order
     */
    clusterPipeline(commands: [string, ...any][]): Promise<[error: Error | null, result: unknown][] | null>;
    /**
     * Retries commands that received redirection responses (ASK or MOVED)
     * This happens when:
     * - A slot is being migrated between nodes
     * - Cluster is rebalancing
     * - Node roles have changed (e.g., failover)
     *
     * @param redirectedCommands Commands that need to be retried
     * @param results Array to store final results
     */
    private retryRedirectedCommands;
    /**
     * Executes pipeline commands across cluster nodes, handling redirections
     * Pipeline execution can fail or require retries when:
     * 1. Cluster topology changes (node addition/removal)
     * 2. Slot migrations are in progress
     * 3. Failover occurs during execution
     * 4. Network issues cause temporary node unavailability
     */
    private executePipelineForCluster;
    /**
     * Checks if a Redis response indicates command redirection
     * Redirection occurs when:
     * - ASK response: Slot is being migrated
     * - MOVED response: Slot mapping has changed
     * These responses contain the command details and target node
     */
    private isRedirectionResponse;
}
export { Redis, ExtendedClusterRedis as Cluster };

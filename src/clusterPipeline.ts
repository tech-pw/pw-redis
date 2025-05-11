import Redis, { Cluster } from 'ioredis';
const calculateSlot = require('cluster-key-slot');

/**
 * Represents a Redis command with its original position in the command batch
 */
interface RedisCommand {
  command: [string, ...any[]];
  index: number;
}

/**
 * Extended Redis Cluster class that handles pipeline operations more efficiently.
 * Specifically handles cases where commands need to be redirected due to:
 * 1. Cluster resharding/rebalancing
 * 2. Master-replica failover
 * 3. Slot migration between nodes
 * 4. Adding/removing nodes from cluster
 */
class ExtendedClusterRedis extends Cluster {
  /**
   * Executes multiple Redis commands in a pipeline across cluster nodes
   * @param commands Array of Redis commands to execute
   * @returns Array of [error, result] pairs matching the input command order
   */
  async clusterPipeline(
    commands: [string, ...any][],
  ): Promise<[error: Error | null, result: unknown][] | null> {
    return this.executePipelineForCluster(commands);
  }

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
  private async retryRedirectedCommands(
    redirectedCommands: RedisCommand[],
    results: ([Error | null, unknown] | null)[]
  ): Promise<void> {
    if (redirectedCommands.length === 0) return;
    const retryPromises = redirectedCommands.map(async ({ command, index }) => {
      try {
        const [cmdName, ...args] = command;
        if (typeof this[cmdName] === 'function') {
          // Individual retries use ioredis's built-in redirection handling
          const retryResult = await this[cmdName](...args);
          results[index] = [null, retryResult];
        } else {
          results[index] = [new Error(`Invalid command: ${cmdName}`), null];
        }
      } catch (error) {
        results[index] = [error instanceof Error ? error : new Error(String(error)), null];
      }
    });

    await Promise.all(retryPromises);
  }

  /**
   * Executes pipeline commands across cluster nodes, handling redirections
   * Pipeline execution can fail or require retries when:
   * 1. Cluster topology changes (node addition/removal)
   * 2. Slot migrations are in progress
   * 3. Failover occurs during execution
   * 4. Network issues cause temporary node unavailability
   */
  private async executePipelineForCluster(
    commands: [string, ...any][],
  ): Promise<[error: Error | null, result: unknown][] | null> {
    // Group commands by node based on key slots
    const pipelinesByNode: Record<
      string,
      { commands: [string, ...any[]][]; originalIndices: number[] }
    > = {};

    // Map commands to nodes using hash slots
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const key = command[1];
      const slot = calculateSlot(key);
      const node = this.slots[slot][0];
      if (!pipelinesByNode[node]) {
        pipelinesByNode[node] = { commands: [], originalIndices: [] };
      }
      pipelinesByNode[node].commands.push(command);
      pipelinesByNode[node].originalIndices.push(i);
    }

    // Track results and commands needing redirection
    const results: ([Error | null, unknown] | null)[] = new Array(commands.length);
    const redirectedCommands: RedisCommand[] = [];

    // Execute pipelines in parallel for each node
    const promises = Object.keys(pipelinesByNode).map(async (node) => {
      const { commands, originalIndices } = pipelinesByNode[node];
      const pipeline = this.pipeline();

      // Add commands to pipeline
      commands.forEach(cmd => pipeline[cmd[0]](...cmd.slice(1)));

      // Execute pipeline for this node
      const nodeResult = await pipeline.exec();

      // Process results and identify redirections
      nodeResult.forEach((result, localIndex) => {
        const originalIndex = originalIndices[localIndex];

        if (this.isRedirectionResponse(result)) {
          // Queue command for retry if it needs redirection
          redirectedCommands.push({
            command: commands[localIndex],
            index: originalIndex
          });
        } else {
          // Store successful results immediately
          results[originalIndex] = result;
        }
      });
    });

    // Wait for all pipeline executions to complete
    await Promise.all(promises);

    // Handle any commands that needed redirection
    await this.retryRedirectedCommands(redirectedCommands, results);

    return results;
  }

  /**
   * Checks if a Redis response indicates command redirection
   * Redirection occurs when:
   * - ASK response: Slot is being migrated
   * - MOVED response: Slot mapping has changed
   * These responses contain the command details and target node
   */
  private isRedirectionResponse(result: any): boolean {
    return Array.isArray(result) &&
      result[0] &&
      typeof result[0] === 'object' &&
      'command' in result[0];
  }
}

export { Redis, ExtendedClusterRedis as Cluster };
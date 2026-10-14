export interface WorkerProgressEvent {
  processed: number;
  total: number;
  percentage: number;
  rowsPerSecond: number;
  stage: "parsing" | "validating" | "importing" | "complete" | "cancelled";
}

export type WorkerProgressCallback = (event: WorkerProgressEvent) => void;

/**
 * Cooperative Async Chunk Runner for 100k+ rows.
 * Uses micro-task time slicing so the POS UI, barcode scanner, and cart animations
 * never freeze during large background imports.
 */
export class NonBlockingChunkRunner {
  private isCancelled = false;

  cancel(): void {
    this.isCancelled = true;
  }

  reset(): void {
    this.isCancelled = false;
  }

  get cancelled(): boolean {
    return this.isCancelled;
  }

  /**
   * Process an array in non-blocking cooperative time slices.
   */
  async processInTimeSlices<T, R>(
    items: T[],
    chunkSize: number,
    processChunk: (chunk: T[], startIndex: number) => Promise<R[]>,
    onProgress?: WorkerProgressCallback
  ): Promise<R[]> {
    this.reset();
    const results: R[] = [];
    const total = items.length;
    const startTime = performance.now();

    for (let i = 0; i < total; i += chunkSize) {
      if (this.isCancelled) {
        if (onProgress) {
          onProgress({
            processed: i,
            total,
            percentage: Math.round((i / total) * 100),
            rowsPerSecond: 0,
            stage: "cancelled",
          });
        }
        break;
      }

      const chunk = items.slice(i, i + chunkSize);
      const chunkResult = await processChunk(chunk, i);
      results.push(...chunkResult);

      const processed = Math.min(i + chunkSize, total);
      const elapsedSec = (performance.now() - startTime) / 1000;
      const speed = elapsedSec > 0 ? Math.round(processed / elapsedSec) : 0;

      if (onProgress) {
        onProgress({
          processed,
          total,
          percentage: Math.round((processed / total) * 100),
          rowsPerSecond: speed,
          stage: processed === total ? "complete" : "importing",
        });
      }

      // Yield thread to POS event loop
      await this.yieldToEventLoop();
    }

    return results;
  }

  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as any).requestIdleCallback(() => resolve(), { timeout: 15 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}

export const nonBlockingChunkRunner = new NonBlockingChunkRunner();

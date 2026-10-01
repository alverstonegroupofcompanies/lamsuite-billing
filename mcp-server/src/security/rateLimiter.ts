export class RateLimiter {
  private requestsPerMinute: number;
  private clientHistory: Map<string, number[]> = new Map();

  constructor(requestsPerMinute: number = 120) {
    this.requestsPerMinute = requestsPerMinute;
  }

  check(clientId: string = "default"): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const windowStart = now - 60000;

    let timestamps = this.clientHistory.get(clientId) || [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.requestsPerMinute) {
      const oldestInWindow = timestamps[0];
      const retryAfterSeconds = Math.ceil((oldestInWindow + 60000 - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      };
    }

    timestamps.push(now);
    this.clientHistory.set(clientId, timestamps);

    return {
      allowed: true,
      remaining: this.requestsPerMinute - timestamps.length,
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.clientHistory.clear();
  }
}

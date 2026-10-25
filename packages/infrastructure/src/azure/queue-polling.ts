/** Per-worker scheduling; the timer itself performs no database work. */
export class QueuePollingPolicy {
  private nextPollAt: number = 0;
  private nextSweepAt: number = 0;
  private idleDelayMs: number = 1000;

  public shouldPoll(now: number): boolean { return now >= this.nextPollAt; }
  public shouldSweep(now: number): boolean { return now >= this.nextSweepAt; }
  public swept(now: number): void { this.nextSweepAt = now + 60_000; }
  public polled(found: boolean, now: number): void {
    if (found) { this.idleDelayMs = 1000; this.nextPollAt = 0; return; }
    // Negative jitter keeps the maximum discovery delay at ten seconds.
    this.nextPollAt = now + Math.floor(this.idleDelayMs * (0.75 + Math.random() * 0.25));
    this.idleDelayMs = Math.min(10_000, this.idleDelayMs * 2);
  }
}

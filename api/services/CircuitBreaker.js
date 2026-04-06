const FAILURE_THRESHOLD = Number(process.env.CIRCUIT_FAILURE_THRESHOLD) || 5;
const RECOVERY_TIMEOUT  = Number(process.env.CIRCUIT_RECOVERY_TIMEOUT)  || 30;

class CircuitBreaker {
  constructor(name) {
    this.name         = name;
    this.state        = "closed";   // closed | open | half_open
    this.failureCount = 0;
    this.lastFailure  = 0;
  }
  allowRequest() {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if ((Date.now() - this.lastFailure) / 1000 >= RECOVERY_TIMEOUT) {
        this.state = "half_open";
        return true;
      }
      return false;
    }
    return true; // half_open
  }
  recordSuccess() { this.failureCount = 0; this.state = "closed"; }
  recordFailure() {
    this.failureCount++;
    this.lastFailure = Date.now();
    if (this.failureCount >= FAILURE_THRESHOLD) {
      this.state = "open";
      console.warn(`[Circuit] ${this.name} OPEN`);
    }
  }
  toJSON() {
    return { state: this.state, failure_count: this.failureCount, threshold: FAILURE_THRESHOLD };
  }
}

export const breakers = {
  apollo:      new CircuitBreaker("apollo"),
  hunter:      new CircuitBreaker("hunter"),
  zerobounce:  new CircuitBreaker("zerobounce"),
};

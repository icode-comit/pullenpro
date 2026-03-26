import time, logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict
import os

logger = logging.getLogger("pullenspro")
FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_FAILURE_THRESHOLD", "5"))
RECOVERY_TIMEOUT  = int(os.getenv("CIRCUIT_RECOVERY_TIMEOUT",  "30"))

class CircuitState(str, Enum):
    CLOSED    = "closed"
    OPEN      = "open"
    HALF_OPEN = "half_open"

@dataclass
class CircuitBreaker:
    name:              str
    failure_threshold: int         = FAILURE_THRESHOLD
    recovery_timeout:  int         = RECOVERY_TIMEOUT
    failure_count:     int         = 0
    last_failure_time: float       = 0.0
    state:             CircuitState = CircuitState.CLOSED

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.monotonic()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning("Circuit [%s] OPEN", self.name)

    def record_success(self):
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def allow_request(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            if time.monotonic() - self.last_failure_time >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                return True
            return False
        return True  # HALF_OPEN

# Shared breakers registry
breakers: Dict[str, CircuitBreaker] = {
    "apollo":      CircuitBreaker("apollo"),
    "hunter":      CircuitBreaker("hunter"),
    "zerobounce":  CircuitBreaker("zerobounce"),
}

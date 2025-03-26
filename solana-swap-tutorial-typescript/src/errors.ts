export class SwapError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SwapError";
    this.code = code;
  }
}

export class InsufficientFundsError extends SwapError {
  constructor(message: string) {
    super(message, "INSUFFICIENT_FUNDS");
  }
}

export class SimulationError extends SwapError {
  constructor(message: string) {
    super(message, "SIMULATION_FAILED");
  }
} 
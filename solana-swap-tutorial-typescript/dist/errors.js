"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationError = exports.InsufficientFundsError = exports.SwapError = void 0;
class SwapError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "SwapError";
        this.code = code;
    }
}
exports.SwapError = SwapError;
class InsufficientFundsError extends SwapError {
    constructor(message) {
        super(message, "INSUFFICIENT_FUNDS");
    }
}
exports.InsufficientFundsError = InsufficientFundsError;
class SimulationError extends SwapError {
    constructor(message) {
        super(message, "SIMULATION_FAILED");
    }
}
exports.SimulationError = SimulationError;

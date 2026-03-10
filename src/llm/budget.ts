/**
 * @module llm/budget
 * @description Cost tracking for LLM API usage. Enforces budget limits
 * and provides cost breakdown by model.
 */

// ── Types ───────────────────────────────────────────────────────────────

/** Options for constructing a BudgetTracker */
export interface BudgetTrackerOptions {
  maxBudgetUsd: number;
}

// ── Budget Tracker ──────────────────────────────────────────────────────

/**
 * Tracks LLM API costs and enforces budget limits.
 *
 * @example
 * ```ts
 * const budget = new BudgetTracker({ maxBudgetUsd: 5.0 });
 * budget.recordCost('gemini-2.0-flash', 0.01);
 * if (budget.canAfford(0.10)) {
 *   // proceed with API call
 * }
 * ```
 */
export class BudgetTracker {
  private readonly maxBudgetUsd: number;
  private spent: number = 0;
  private readonly costsByModel: Record<string, number> = {};

  /**
   * @param options - Configuration options including max budget
   */
  constructor(options: BudgetTrackerOptions | number) {
    if (typeof options === 'number') {
      this.maxBudgetUsd = options;
    } else {
      this.maxBudgetUsd = options.maxBudgetUsd;
    }
  }

  /**
   * Record the cost of an API call.
   * @param model - Model identifier
   * @param costUsd - Cost in USD
   */
  recordCost(model: string, costUsd: number): void {
    this.costsByModel[model] = (this.costsByModel[model] ?? 0) + costUsd;
    this.spent += costUsd;
  }

  /**
   * Get the total amount spent so far in USD.
   * @returns Total spent
   */
  totalSpent(): number {
    return this.spent;
  }

  /**
   * Check if there is enough remaining budget for an estimated cost.
   * @param estimatedCostUsd - The estimated cost of the next operation
   * @returns true if the cost would not exceed the budget
   */
  canAfford(estimatedCostUsd: number): boolean {
    return this.spent + estimatedCostUsd <= this.maxBudgetUsd;
  }

  /**
   * Get a cost breakdown by model.
   * @returns Map of model name to total cost in USD
   */
  getCostBreakdown(): Record<string, number> {
    return { ...this.costsByModel };
  }

  /**
   * Get the remaining budget in USD.
   * @returns Remaining budget (never negative)
   */
  remainingBudget(): number {
    return Math.max(0, this.maxBudgetUsd - this.spent);
  }

  /**
   * Reset all recorded costs and breakdown.
   */
  reset(): void {
    this.spent = 0;
    for (const key of Object.keys(this.costsByModel)) {
      delete this.costsByModel[key];
    }
  }
}

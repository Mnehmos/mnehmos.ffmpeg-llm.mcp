/**
 * @module llm/budget
 * @description Cost tracking for LLM API usage. Enforces budget limits
 * and provides cost breakdown by model.
 */

// ── Types ───────────────────────────────────────────────────────────────

/** A single recorded cost entry */
interface CostEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

// ── Budget Tracker ──────────────────────────────────────────────────────

/**
 * Tracks LLM API costs and enforces budget limits.
 *
 * @example
 * ```ts
 * const budget = new BudgetTracker(5.0); // $5 max
 * budget.recordCost('gemini-2.0-flash', 1000, 500);
 * if (budget.canAfford(0.10)) {
 *   // proceed with API call
 * }
 * ```
 */
export class BudgetTracker {
  private readonly maxBudgetUsd: number;
  private totalSpentUsd: number = 0;
  private readonly entries: CostEntry[] = [];

  /**
   * @param maxBudgetUsd - Maximum allowed budget in USD
   */
  constructor(maxBudgetUsd: number) {
    this.maxBudgetUsd = maxBudgetUsd;
  }

  /**
   * Record the cost of an API call.
   * @param model - Model identifier
   * @param inputTokens - Number of input tokens used
   * @param outputTokens - Number of output tokens used
   */
  recordCost(model: string, inputTokens: number, outputTokens: number): void {
    // TODO: Use model-specific pricing for accurate cost calculation
    const inputCostPer1k = model.includes('gemini') ? 0.00015 : 0.001;
    const outputCostPer1k = model.includes('gemini') ? 0.0006 : 0.003;
    const costUsd = (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;

    this.entries.push({
      model,
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    });

    this.totalSpentUsd += costUsd;
  }

  /**
   * Check if there is enough remaining budget for an estimated cost.
   * @param estimatedCostUsd - The estimated cost of the next operation
   * @returns true if the cost would not exceed the budget
   */
  canAfford(estimatedCostUsd: number): boolean {
    return this.totalSpentUsd + estimatedCostUsd <= this.maxBudgetUsd;
  }

  /**
   * Get the total amount spent so far in USD.
   * @returns Total spent
   */
  getSpent(): number {
    return this.totalSpentUsd;
  }

  /**
   * Get the remaining budget in USD.
   * @returns Remaining budget
   */
  getRemainingBudget(): number {
    return Math.max(0, this.maxBudgetUsd - this.totalSpentUsd);
  }

  /**
   * Get a cost breakdown by model.
   * @returns Map of model name to total cost in USD
   */
  getCostBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const entry of this.entries) {
      breakdown[entry.model] = (breakdown[entry.model] ?? 0) + entry.costUsd;
    }
    return breakdown;
  }

  /**
   * Get the total number of API calls made.
   * @returns Number of recorded cost entries
   */
  getCallCount(): number {
    return this.entries.length;
  }
}

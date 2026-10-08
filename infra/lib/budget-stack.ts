import * as cdk from 'aws-cdk-lib/core';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';

export interface BudgetStackProps extends cdk.StackProps {
  alertEmail: string;
}

// Of the $100 AWS credit (architecture.md §15 Q1), alert at these actual-spend levels.
export const ALERT_THRESHOLDS_USD = [60, 85] as const;
export const CREDIT_USD = 100;

/**
 * Cost guardrail for the whole project. One calendar-year cost budget, measured before
 * credits are applied (IncludeCredit: false), so it shows what the credit is paying for
 * instead of a net $0. Emails at each absolute threshold of actual spend.
 */
export class BudgetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);

    new budgets.CfnBudget(this, 'CreditBudget', {
      budget: {
        budgetName: 'apuracao26-credit',
        budgetType: 'COST',
        timeUnit: 'ANNUALLY',
        budgetLimit: { amount: CREDIT_USD, unit: 'USD' },
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: ALERT_THRESHOLDS_USD.map((threshold) => ({
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'ABSOLUTE_VALUE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
      })),
    });
  }
}

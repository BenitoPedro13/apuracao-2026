import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { BudgetStack } from '../lib/budget-stack';

test('budget alerts at $60 and $85 of the $100 credit, before credits', () => {
  const app = new cdk.App();
  const stack = new BudgetStack(app, 'TestBudget', { alertEmail: 'test@example.invalid' });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::Budgets::Budget', 1);
  const [budget] = Object.values(template.findResources('AWS::Budgets::Budget'));
  const props = budget!.Properties;

  expect(props.Budget.BudgetLimit).toEqual({ Amount: 100, Unit: 'USD' });
  expect(props.Budget.CostTypes.IncludeCredit).toBe(false);
  expect(props.NotificationsWithSubscribers.map((n: { Notification: { Threshold: number } }) => n.Notification.Threshold)).toEqual([60, 85]);
  for (const n of props.NotificationsWithSubscribers) {
    expect(n.Notification.NotificationType).toBe('ACTUAL');
    expect(n.Subscribers).toEqual([{ SubscriptionType: 'EMAIL', Address: 'test@example.invalid' }]);
  }
});

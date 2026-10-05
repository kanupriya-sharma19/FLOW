import { CronExpressionParser } from "cron-parser";

export const calculateNextRun = (
  cronExpression: string,
  currentRunAt: Date = new Date(),
): Date => {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: currentRunAt,
  });

  return interval.next().toDate();
};

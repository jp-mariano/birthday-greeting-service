import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { BirthdayMessage } from '../types/models';
import { DateTime } from 'luxon';

export class SchedulerService {
  private client: SchedulerClient;
  private senderFunctionArn: string;

  constructor(client?: SchedulerClient) {
    this.client = client || new SchedulerClient({} as any);
    this.senderFunctionArn = 'test-sender-function-arn';
  }

  async scheduleMessage(message: BirthdayMessage, date: string): Promise<void> {
    try {
      const scheduleDate = DateTime.fromISO(date);
      const scheduleTime = DateTime.fromObject({
        hour: 9,
        minute: 0,
        second: 0
      }, {
        zone: message.location
      });

      const cronExpression = `cron(0 ${scheduleTime.hour} ${scheduleDate.day} ${scheduleDate.month} ? ${scheduleDate.year})`;

      const command = new CreateScheduleCommand({
        Name: `${message.userId}_${date}`,
        ScheduleExpression: cronExpression,
        Target: {
          Arn: this.senderFunctionArn,
          RoleArn: 'test-role-arn',
          Input: JSON.stringify(message)
        },
        FlexibleTimeWindow: {
          Mode: 'OFF'
        }
      });

      await this.client.send(command);
    } catch (error) {
      throw new Error('Failed to create schedule');
    }
  }

  async deleteSchedule(userId: string, date: string): Promise<void> {
    try {
      const command = new DeleteScheduleCommand({
        Name: `${userId}_${date}`
      });

      await this.client.send(command);
    } catch (error) {
      throw new Error('Failed to delete schedule');
    }
  }
} 
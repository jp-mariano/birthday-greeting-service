import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { BirthdayMessage } from '../types/models';
import { DateTime } from 'luxon';

export class SchedulerService {
  private client: SchedulerClient;
  private senderFunctionArn: string;

  constructor(client?: SchedulerClient) {
    if (client) {
      this.client = client;
    } else {
      const config: any = {
        region: process.env.AWS_REGION || 'us-east-1'
      };

      // Use LocalStack endpoint if available
      if (process.env.SCHEDULER_ENDPOINT) {
        config.endpoint = process.env.SCHEDULER_ENDPOINT;
        // For LocalStack, we don't need real credentials
        config.credentials = {
          accessKeyId: 'test',
          secretAccessKey: 'test'
        };
        // Required for LocalStack scheduler
        config.forcePathStyle = true;
      }

      this.client = new SchedulerClient(config);
    }

    // In local development, use the local Lambda function ARN
    const isLocal = process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local';
    this.senderFunctionArn = isLocal 
      ? 'arn:aws:lambda:us-east-1:000000000000:function:birthday-service-local-birthdayMessageSender'
      : process.env.SENDER_FUNCTION_ARN || '';
  }

  async scheduleMessage(message: BirthdayMessage, date: string): Promise<void> {
    try {
      const scheduleDate = DateTime.fromISO(date);
      
      // Create 9am in user's timezone
      const localScheduleTime = DateTime.fromObject({
        year: scheduleDate.year,
        month: scheduleDate.month,
        day: scheduleDate.day,
        hour: 9,
        minute: 0,
        second: 0
      }, {
        zone: message.location
      });

      // Convert to UTC for the cron expression
      const utcScheduleTime = localScheduleTime.toUTC();
      console.log(`Scheduling message for ${message.firstName} ${message.lastName}:`);
      console.log(`Local time: ${localScheduleTime.toISO()}`);
      console.log(`UTC time: ${utcScheduleTime.toISO()}`);

      // For local testing, use rate expression
      const isLocal = process.env.IS_OFFLINE === 'true' || process.env.STAGE === 'local';
      
      // Format for LocalStack: rate(X minutes) or cron(* * * * ? *)
      const cronExpression = isLocal
        ? `rate(1 minute)`  // LocalStack doesn't support 'at' expressions, use rate instead
        : `cron(${utcScheduleTime.minute} ${utcScheduleTime.hour} ${utcScheduleTime.day} ${utcScheduleTime.month} ? ${utcScheduleTime.year})`;

      console.log('Creating schedule with expression:', cronExpression);

      const command = new CreateScheduleCommand({
        Name: `${message.userId}_${date}`,
        ScheduleExpression: cronExpression,
        Target: {
          Arn: this.senderFunctionArn,
          RoleArn: process.env.SCHEDULER_ROLE_ARN || 'arn:aws:iam::000000000000:role/scheduler-role',
          Input: JSON.stringify(message)
        },
        FlexibleTimeWindow: {
          Mode: 'OFF'
        }
      });

      await this.client.send(command);
      console.log(`Scheduled message for user ${message.userId} with expression ${cronExpression}`);
    } catch (error) {
      console.error('Failed to create schedule:', error);
      throw new Error('Failed to create schedule');
    }
  }

  async deleteSchedule(userId: string, date: string): Promise<void> {
    try {
      const command = new DeleteScheduleCommand({
        Name: `${userId}_${date}`
      });

      await this.client.send(command);
      console.log(`Deleted schedule for user ${userId} on ${date}`);
    } catch (error) {
      console.error('Failed to delete schedule:', error);
      throw new Error('Failed to delete schedule');
    }
  }
} 
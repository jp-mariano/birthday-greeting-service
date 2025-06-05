import { Context, EventBridgeEvent } from 'aws-lambda';
import { DynamoDBService } from '../services/dynamodb';
import { SchedulerService } from '../services/scheduler';
import { DateTime } from 'luxon';

// Create default instances for direct Lambda invocation
const defaultDb = new DynamoDBService();
const defaultScheduler = new SchedulerService();

export const handler = async (
  _event: EventBridgeEvent<'Scheduled Event', any>,
  _context: Context,
  dbService: DynamoDBService = defaultDb,
  schedulerService: SchedulerService = defaultScheduler
): Promise<void> => {
  try {
    // Get all users with birthdays today
    const users = await dbService.getTodaysBirthdays();
    console.log(`Found ${users.length} birthdays for today`);

    const today = DateTime.utc().toFormat('yyyy-MM-dd');

    // Schedule birthday messages for each user
    for (const user of users) {
      await schedulerService.scheduleMessage({
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        location: user.location
      }, today);
    }

    console.log(`Successfully scheduled ${users.length} birthday messages`);
  } catch (error) {
    console.error('Error processing daily birthday aggregation:', error);
    throw error; // Rethrowing to trigger Lambda retry
  }
}; 
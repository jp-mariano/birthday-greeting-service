import { Context, APIGatewayProxyEvent, APIGatewayProxyResult, EventBridgeEvent } from 'aws-lambda';
import { DynamoDBService } from '../services/dynamodb';
import { SchedulerService } from '../services/scheduler';
import { DateTime } from 'luxon';

export const handler = async (
  event: APIGatewayProxyEvent | EventBridgeEvent<'Scheduled Event', any>,
  _context: Context
): Promise<void | APIGatewayProxyResult> => {
  // Create service instances inside the handler
  const dbService = new DynamoDBService();
  const schedulerService = new SchedulerService();

  try {
    // Get all users with birthdays today
    const users = await dbService.getTodaysBirthdays();
    console.log(`Found ${users.length} birthdays for today`);

    const today = DateTime.utc().toFormat('yyyy-MM-dd');
    const processedUsers = [];

    // Process birthday messages for each user
    for (const user of users) {
      const messageId = `${user.userId}_${today}`;
      
      // Check if we already have a message log for today
      const existingLog = await dbService.getMessageLog(messageId);
      if (existingLog) {
        console.log(`Message log already exists for user ${user.userId} on ${today}, skipping...`);
        continue;
      }

      const message = {
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
        location: user.location
      };

      try {
        // Create message log first
        await dbService.createMessageLog(user.userId, today);
        
        // Then create the schedule
        await schedulerService.scheduleMessage(message, today);
        processedUsers.push(message);
      } catch (error) {
        console.error(`Failed to process birthday for user ${user.userId}:`, error);
        // If schedule creation fails, we should clean up the message log
        try {
          await dbService.updateMessageStatus(messageId, 'FAILED');
        } catch (cleanupError) {
          console.error(`Failed to cleanup message log for ${messageId}:`, cleanupError);
        }
      }
    }

    // If this was triggered by HTTP request, return a response
    if ('httpMethod' in event) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: `Successfully processed ${processedUsers.length} birthdays`,
          users: processedUsers
        })
      };
    }
  } catch (error) {
    console.error('Error processing daily birthday aggregation:', error);
    
    // If this was triggered by HTTP request, return an error response
    if ('httpMethod' in event) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to process daily birthdays',
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      };
    }
    
    // For EventBridge events, we should rethrow to trigger the DLQ
    throw error;
  }
}; 
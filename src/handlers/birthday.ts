import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, ScheduledEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../services/database';

const sqs = new SQSClient({});

export const handler = async (
  event: APIGatewayProxyEvent | ScheduledEvent,
  _context: Context
): Promise<void | APIGatewayProxyResult> => {
  const db = DatabaseService.getInstance();

  try {
    // Find users whose local time is 9:00 AM and it's their birthday
    const usersToGreet = await db.getUsersWithBirthdayNow();
    console.log(`Found ${usersToGreet.length} users to send birthday greetings to`);

    // Send messages to SQS for webhook processing
    for (const user of usersToGreet) {
      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
            MessageBody: JSON.stringify({
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              location: user.location,
              message: `Hey, ${user.firstName} ${user.lastName} it's your birthday`
            })
          })
        );

        console.log(`Successfully queued birthday greeting for ${user.firstName} ${user.lastName}`);
      } catch (error) {
        console.error(`Failed to queue greeting for user ${user.id}:`, error);
        // Continue with next user even if one fails
      }
    }

    // If this was triggered by HTTP request, return a response
    if ('httpMethod' in event) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Successfully queued ${usersToGreet.length} birthday greetings`,
          users: usersToGreet.map(u => ({
            id: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            location: u.location
          }))
        })
      };
    }
  } catch (error) {
    console.error('Error processing birthday greetings:', error);
    
    // If this was triggered by HTTP request, return an error response
    if ('httpMethod' in event) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to process birthday greetings',
          details: error instanceof Error ? error.message : 'Unknown error'
        })
      };
    }

    // For scheduled events, we should rethrow to trigger the Lambda retry
    throw error;
  } finally {
    // Cleanup database connections
    await db.cleanup();
  }
}; 
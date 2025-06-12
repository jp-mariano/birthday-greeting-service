import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../services/database';

const sqs = new SQSClient({});
const BATCH_SIZE = 200; // Number of records per message

interface WebhookMessage {
  userId: string;
  firstName: string;
  lastName: string;
  location: string;
  message: string;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

export const handler = async (
  _event: ScheduledEvent,
  _context: Context
): Promise<void> => {
  const db = DatabaseService.getInstance();

  try {
    // Find users whose local time is 9:00 AM and it's their birthday
    const usersToGreet = await db.getUsersWithBirthdayNow();
    console.log(`Found ${usersToGreet.length} users to send birthday greetings to`);

    // Convert users to webhook messages
    const messages: WebhookMessage[] = usersToGreet.map(user => ({
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      location: user.location,
      message: `Hey, ${user.firstName} ${user.lastName} it's your birthday`
    }));

    // Split messages into chunks of BATCH_SIZE
    const messageChunks = chunkArray(messages, BATCH_SIZE);

    // Send all chunks in a single batch operation
    const response = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
        Entries: messageChunks.map((chunk, index) => ({
          Id: `batch-${index}`,
          MessageBody: JSON.stringify({
            records: chunk
          })
        }))
      })
    );

    if (response.Failed && response.Failed.length > 0) {
      console.error('Failed to queue some batches:', response.Failed);
    }

    console.log(`Successfully queued ${response.Successful?.length ?? 0} batches of messages`);
  } catch (error) {
    console.error('Error processing birthday greetings:', error);
    throw error;
  } finally {
    await db.cleanup();
  }
}; 
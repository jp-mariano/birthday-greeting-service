import { SQSEvent, Context } from 'aws-lambda';
import { DatabaseService } from '../services/database';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

interface WebhookMessage {
  userId: string;
  firstName: string;
  lastName: string;
  location: string;
  message: string;
}

const sqs = new SQSClient({});

export const handler = async (
  event: SQSEvent,
  _context: Context
): Promise<void> => {
  if (!event.Records || event.Records.length !== 1) {
    throw new Error('Expected exactly one record in SQS event');
  }

  const body = JSON.parse(event.Records[0].body);
  
  // Standardize the message format - always expect records array
  if (!('records' in body)) {
    throw new Error('Message format error: expected records array');
  }

  const messages: WebhookMessage[] = body.records;
  
  // Process each message individually so failures don't affect other records
  for (const message of messages) {
    try {
      await processWebhook(message);
    } catch (error) {
      // Send failed message to DLQ as a batched message with single record
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.WEBHOOK_DLQ_URL!,
        MessageBody: JSON.stringify({
          records: [message]
        })
      }));
      
      console.error(`Failed to process webhook for user ${message.userId}:`, error);
      // Don't throw error since we've handled it by sending to DLQ
      // This prevents the entire batch from being retried
    }
  }
};

async function processWebhook(message: WebhookMessage): Promise<void> {
  const db = DatabaseService.getInstance();
  try {
    // Check if we can send a greeting before making the API call
    const canSend = await db.canSendGreeting(message.userId);
    if (!canSend) {
      console.log(`Skipping greeting for user ${message.userId} - already sent this year`);
      return;
    }

    const response = await fetch(process.env.WEBHOOK_ENDPOINT!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`);
    }

    // Only update the database if webhook was successful
    await db.updateLastGreetingSent(message.userId);
    console.log(`Successfully sent webhook and updated greeting timestamp for user ${message.firstName} ${message.lastName}`);
  } catch (error) {
    console.error(`Failed to send webhook for user ${message.userId}:`, error);
    throw error;
  } finally {
    await db.cleanup();
  }
} 
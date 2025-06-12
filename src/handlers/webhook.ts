import { SQSEvent, ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../services/database';

interface WebhookMessage {
  userId: string;
  firstName: string;
  lastName: string;
  location: string;
  message: string;
  retryCount?: number;
}

const sqs = new SQSClient({});

export const handler = async (
  event: SQSEvent | ScheduledEvent,
  _context: Context
): Promise<void> => {
  try {
    if ('Records' in event) {
      // Process messages from the main queue
      for (const record of event.Records) {
        const message: WebhookMessage = JSON.parse(record.body);
        await processWebhook(message);
      }
    } else {
      // Scheduled event - check DLQ for failed messages to retry
      await retryFailedWebhooks();
    }
  } catch (error) {
    console.error('Error in webhook handler:', error);
    throw error;
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
    // The message will be moved to DLQ after max retries (configured in SQS)
    throw error;
  } finally {
    await db.cleanup();
  }
}

async function retryFailedWebhooks(): Promise<void> {
  const dlqUrl = process.env.WEBHOOK_DLQ_URL!;
  
  // Check if there are any messages in DLQ
  const attributesResponse = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['ApproximateNumberOfMessages']
    })
  );

  const messageCount = parseInt(
    attributesResponse.Attributes?.ApproximateNumberOfMessages || '0'
  );

  if (messageCount === 0) {
    console.log('No failed webhooks to retry');
    return;
  }

  console.log(`Found ${messageCount} failed webhooks to retry`);

  // Process messages in batches
  while (true) {
    const receiveResponse = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30
      })
    );

    if (!receiveResponse.Messages || receiveResponse.Messages.length === 0) {
      break;
    }

    for (const message of receiveResponse.Messages) {
      try {
        const webhookMessage: WebhookMessage = JSON.parse(message.Body!);
        
        // Increment retry count
        webhookMessage.retryCount = (webhookMessage.retryCount || 0) + 1;
        
        // Try to send the webhook again
        await processWebhook(webhookMessage);

        // If successful, delete from DLQ
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: dlqUrl,
            ReceiptHandle: message.ReceiptHandle
          })
        );

        console.log(`Successfully retried webhook for user ${webhookMessage.userId}`);
      } catch (error) {
        console.error('Failed to process message from DLQ:', error);
        // Leave the message in DLQ for next retry
      }
    }
  }
} 
import { ScheduledEvent, Context } from 'aws-lambda';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

export const handler = async (
  _event: ScheduledEvent,
  _context: Context
): Promise<void> => {
  const dlqUrl = process.env.WEBHOOK_DLQ_URL!;
  const mainQueueUrl = process.env.WEBHOOK_QUEUE_URL!;
  
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

  console.log(`Found ${messageCount} failed webhook messages to retry`);

  // Receive a batch of messages
  const receiveResponse = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: dlqUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 30
    })
  );

  if (!receiveResponse.Messages || receiveResponse.Messages.length === 0) {
    return;
  }

  // Process one message at a time
  const message = receiveResponse.Messages[0];
  
  try {
    // Send the message back to the main queue
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: mainQueueUrl,
        MessageBody: message.Body!
      })
    );

    // Delete from DLQ after successful redrive
    await deleteFromDLQ(dlqUrl, message.ReceiptHandle!);
    console.log('Successfully redrove message from DLQ to main queue');
  } catch (error) {
    console.error('Failed to redrive message:', error);
    // Let visibility timeout expire naturally
  }
};

async function deleteFromDLQ(dlqUrl: string, receiptHandle: string): Promise<void> {
  try {
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: dlqUrl,
        ReceiptHandle: receiptHandle
      })
    );
  } catch (error) {
    console.error('Failed to delete message from DLQ:', error);
  }
} 
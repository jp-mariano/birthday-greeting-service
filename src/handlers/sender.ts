import { Context } from 'aws-lambda';
import { DynamoDBService } from '../services/dynamodb';
import { BirthdayMessage } from '../types/models';
import { DateTime } from 'luxon';

// Create default instance for direct Lambda invocation
const defaultDb = new DynamoDBService();

async function sendToHookbin(message: BirthdayMessage): Promise<void> {
  const response = await fetch(process.env.WEBHOOK_ENDPOINT!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.statusText}`);
  }
}

export const handler = async (
  message: BirthdayMessage,
  _context: Context,
  dbService: DynamoDBService = defaultDb
): Promise<void> => {
  try {
    const today = DateTime.utc().toFormat('yyyy-MM-dd');
    const messageId = `${message.userId}_${today}`;

    // Check if message has already been processed
    const existingLog = await dbService.getMessageLog(messageId);
    if (existingLog?.status === 'SENT') {
      console.log(`Message ${messageId} has already been sent`);
      return;
    }

    // Create message log if it doesn't exist
    if (!existingLog) {
      await dbService.createMessageLog(message.userId, today);
    }

    // Send birthday message
    await sendToHookbin(message);

    // Update message status
    await dbService.updateMessageStatus(messageId, 'SENT');

    console.log(`Successfully sent birthday message to ${message.firstName} ${message.lastName}`);
  } catch (error) {
    console.error('Error processing birthday message:', error);
    throw error;
  }
}; 
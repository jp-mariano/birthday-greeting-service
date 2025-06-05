import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBService } from '../services/dynamodb';
import { BirthdayMessage, BirthdayMessageSchema } from '../types/models';
import { DateTime } from 'luxon';
import { ZodError } from 'zod';

const MAX_ATTEMPTS = 3;

async function sendToHookbin(message: BirthdayMessage): Promise<void> {
  // Prepare the webhook payload with the birthday message
  const webhookPayload = {
    ...message,
    message: `Hey, ${message.firstName} ${message.lastName} it's your birthday`
  };

  // Log the message in development for debugging
  if (process.env.IS_OFFLINE || process.env.STAGE === 'local') {
    console.log('🎂 Sending birthday message:', webhookPayload);
  }

  try {
    // Always attempt to send to the webhook
    const response = await fetch(process.env.WEBHOOK_ENDPOINT!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });

    console.log('Webhook response status:', response.status);
    const responseText = await response.text();
    console.log('Webhook response body:', responseText);

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}: ${responseText}`);
    }

    // Consider any response as success for Pipedream
    // Pipedream always returns a 200 OK with "Success!" message
    return;
  } catch (error) {
    console.error('Error sending webhook:', error);
    throw error;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  const dbService = new DynamoDBService();

  try {
    const message = BirthdayMessageSchema.parse(JSON.parse(event.body!));
    const today = DateTime.utc().toFormat('yyyy-MM-dd');
    const messageId = `${message.userId}_${today}`;

    // Check if message has already been processed
    const existingLog = await dbService.getMessageLog(messageId);
    console.log('Message log status check:', { messageId, existingLog });
    
    if (existingLog?.status === 'SENT') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: `Message ${messageId} has already been sent` })
      };
    }

    // Check if we've exceeded max attempts
    if (existingLog?.attempts && existingLog.attempts >= MAX_ATTEMPTS) {
      console.log(`Message ${messageId} has exceeded maximum retry attempts (${MAX_ATTEMPTS})`);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Max retry attempts exceeded',
          details: `Failed to send message after ${MAX_ATTEMPTS} attempts`
        })
      };
    }

    // Create message log if it doesn't exist
    if (!existingLog) {
      console.log('Creating new message log for:', messageId);
      await dbService.createMessageLog(message.userId, today);
    }

    try {
      // Send birthday message
      console.log('Attempting to send webhook for:', messageId);
      await sendToHookbin(message);
      console.log('Webhook sent successfully for:', messageId);

      // Update message status
      console.log('Updating message status to SENT for:', messageId);
      const updatedLog = await dbService.updateMessageStatus(messageId, 'SENT');
      console.log('Updated message log:', updatedLog);

      console.log(`Successfully sent birthday message to ${message.firstName} ${message.lastName}`);
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Birthday message sent successfully' })
      };
    } catch (error) {
      // If webhook fails, update status to FAILED and include attempt count
      console.error('Failed to send webhook, updating status to FAILED:', messageId);
      const updatedLog = await dbService.updateMessageStatus(messageId, 'FAILED');
      
      // If we haven't exceeded max attempts, throw error to trigger retry
      if (updatedLog.attempts < MAX_ATTEMPTS) {
        console.log(`Attempt ${updatedLog.attempts} of ${MAX_ATTEMPTS} failed, will retry...`);
        throw error;
      }

      console.log(`All ${MAX_ATTEMPTS} attempts failed for message ${messageId}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to send message',
          details: error instanceof Error ? error.message : 'Unknown error',
          attempts: updatedLog.attempts
        })
      };
    }
  } catch (error) {
    console.error('Error processing birthday message:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal server error',
        details: error instanceof ZodError ? error.errors : undefined
      })
    };
  }
}; 
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBService } from '../services/dynamodb';
import { SchedulerService } from '../services/scheduler';
import { CreateUserRequestSchema } from '../types/models';
import { DateTime } from 'luxon';
import { ZodError } from 'zod';

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  // Create service instances inside the handler
  const dbService = new DynamoDBService();
  const schedulerService = new SchedulerService();

  try {
    switch (event.httpMethod) {
      case 'POST': {
        const userData = CreateUserRequestSchema.parse(JSON.parse(event.body!));
        const user = await dbService.createUser(userData);

        // Check if the user's birthday is today, if so create a schedule
        const today = DateTime.utc().toFormat('yyyy-MM-dd');
        const userBirthdayMD = DateTime.fromISO(userData.birthday).toFormat('MM-dd');
        const todayMD = DateTime.fromISO(today).toFormat('MM-dd');

        if (userBirthdayMD === todayMD) {
          console.log('User birthday is today, creating schedule...');
          const message = {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            location: user.location
          };
          await schedulerService.scheduleMessage(message, today);
          console.log('Schedule created successfully');
        }

        return {
          statusCode: 201,
          body: JSON.stringify(user)
        };
      }

      case 'PUT': {
        const userId = event.pathParameters?.userId;
        if (!userId) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing userId parameter' })
          };
        }

        const updates = CreateUserRequestSchema.parse(JSON.parse(event.body!));
        const user = await dbService.updateUser(userId, updates);

        // If birthday was updated, delete existing schedule
        const today = DateTime.utc().toFormat('yyyy-MM-dd');
        const messageLog = await dbService.getMessageLog(`${userId}_${today}`);
        if (messageLog) {
          await schedulerService.deleteSchedule(userId, today);
        }

        return {
          statusCode: 200,
          body: JSON.stringify(user)
        };
      }

      case 'DELETE': {
        const userId = event.pathParameters?.userId;
        if (!userId) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing userId parameter' })
          };
        }

        await dbService.deleteUser(userId);

        // Delete any existing schedule
        const today = DateTime.utc().toFormat('yyyy-MM-dd');
        const messageLog = await dbService.getMessageLog(`${userId}_${today}`);
        if (messageLog) {
          await schedulerService.deleteSchedule(userId, today);
        }

        return {
          statusCode: 204,
          body: ''
        };
      }

      default:
        return {
          statusCode: 405,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Error processing request:', error);

    if (error instanceof ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request data', details: error.errors })
      };
    }

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: error.message })
        };
      }

      if (error.message.includes('already exists')) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: error.message })
        };
      }

      if (error.message === 'Unexpected end of JSON input' || error.message.includes('JSON')) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}; 
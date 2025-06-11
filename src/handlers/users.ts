import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DatabaseService } from '../services/database';
import { z } from 'zod';

// Schema for user creation/update
const UserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthday: z.string().refine(val => !isNaN(Date.parse(val)), {
    message: "Birthday must be a valid date"
  }),
  location: z.string().refine(val => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: val });
      return true;
    } catch (e) {
      return false;
    }
  }, {
    message: "Must be a valid IANA timezone"
  })
});

export const handler = async (
  event: APIGatewayProxyEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  const db = DatabaseService.getInstance();

  try {
    switch (event.httpMethod) {
      case 'POST': {
        const userData = UserSchema.parse(JSON.parse(event.body!));
        
        const user = await db.createUser({
          ...userData,
          birthday: new Date(userData.birthday)
        });

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

        const updates = UserSchema.partial().parse(JSON.parse(event.body!));
        
        const user = await db.updateUser(userId, {
          ...updates,
          birthday: updates.birthday ? new Date(updates.birthday) : undefined
        });

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

        await db.deleteUser(userId);

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
    console.error('Error processing user request:', error);

    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Validation error',
          details: error.errors
        })
      };
    }

    if (error instanceof Error && error.message === 'User not found') {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  } finally {
    await db.cleanup();
  }
}; 
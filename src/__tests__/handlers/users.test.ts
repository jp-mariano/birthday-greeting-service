import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../handlers/users';
import { DatabaseService } from '../../services/database';

// Mock the DatabaseService
jest.mock('../../services/database', () => {
  const mockDb = {
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    cleanup: jest.fn()
  };
  return {
    DatabaseService: {
      getInstance: jest.fn(() => mockDb)
    }
  };
});

describe('Users Handler', () => {
  let mockDb: jest.Mocked<Pick<DatabaseService, 'createUser' | 'updateUser' | 'deleteUser' | 'cleanup'>>;
  let mockEvent: Partial<APIGatewayProxyEvent>;
  let mockContext: Partial<Context>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mock database instance
    mockDb = (DatabaseService.getInstance() as unknown) as typeof mockDb;

    // Setup default mock event and context
    mockEvent = {
      httpMethod: 'POST',
      body: null,
      pathParameters: {}
    };

    mockContext = {};
  });

  describe('POST /users', () => {
    const validUser = {
      firstName: 'John',
      lastName: 'Doe',
      birthday: '1990-01-01',
      location: 'Asia/Singapore'
    };

    it('should create a user successfully', async () => {
      // Setup
      mockEvent.body = JSON.stringify(validUser);
      mockDb.createUser.mockResolvedValueOnce({
        id: '123',
        ...validUser,
        birthday: new Date(validUser.birthday),
        createdAt: new Date(),
        updatedAt: new Date(),
        lastGreetingSentAt: undefined
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        id: '123',
        firstName: validUser.firstName,
        lastName: validUser.lastName,
        location: validUser.location
      }));
      expect(mockDb.createUser).toHaveBeenCalledWith({
        ...validUser,
        birthday: expect.any(Date)
      });
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      // Setup - missing required fields
      mockEvent.body = JSON.stringify({
        firstName: 'John'
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Validation error'
      }));
      expect(mockDb.createUser).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should validate birthday format', async () => {
      // Setup - invalid date
      mockEvent.body = JSON.stringify({
        ...validUser,
        birthday: 'not-a-date'
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Validation error'
      }));
      expect(mockDb.createUser).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should validate timezone format', async () => {
      // Setup - invalid timezone
      mockEvent.body = JSON.stringify({
        ...validUser,
        location: 'Invalid/Timezone'
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Validation error'
      }));
      expect(mockDb.createUser).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      // Setup
      mockEvent.body = JSON.stringify(validUser);
      mockDb.createUser.mockRejectedValueOnce(new Error('Database error'));

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Internal server error',
        details: 'Database error'
      }));
      expect(mockDb.cleanup).toHaveBeenCalled();
    });
  });

  describe('PUT /users/{userId}', () => {
    const userId = '123';
    const validUpdates = {
      firstName: 'Jane',
      lastName: 'Smith'
    };

    it('should update a user successfully', async () => {
      // Setup
      mockEvent.httpMethod = 'PUT';
      mockEvent.pathParameters = { userId };
      mockEvent.body = JSON.stringify(validUpdates);
      mockDb.updateUser.mockResolvedValueOnce({
        id: userId,
        ...validUpdates,
        birthday: new Date('1990-01-01'),
        location: 'Asia/Singapore',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastGreetingSentAt: undefined
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        id: userId,
        ...validUpdates
      }));
      expect(mockDb.updateUser).toHaveBeenCalledWith(userId, validUpdates);
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle missing userId', async () => {
      // Setup
      mockEvent.httpMethod = 'PUT';
      mockEvent.pathParameters = {};
      mockEvent.body = JSON.stringify(validUpdates);

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Missing userId parameter'
      }));
      expect(mockDb.updateUser).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle non-existent user', async () => {
      // Setup
      mockEvent.httpMethod = 'PUT';
      mockEvent.pathParameters = { userId };
      mockEvent.body = JSON.stringify(validUpdates);
      mockDb.updateUser.mockRejectedValueOnce(new Error('User not found'));

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'User not found'
      }));
      expect(mockDb.cleanup).toHaveBeenCalled();
    });
  });

  describe('DELETE /users/{userId}', () => {
    const userId = '123';

    it('should delete a user successfully', async () => {
      // Setup
      mockEvent.httpMethod = 'DELETE';
      mockEvent.pathParameters = { userId };
      mockDb.deleteUser.mockResolvedValueOnce();

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(mockDb.deleteUser).toHaveBeenCalledWith(userId);
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle missing userId', async () => {
      // Setup
      mockEvent.httpMethod = 'DELETE';
      mockEvent.pathParameters = {};

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Missing userId parameter'
      }));
      expect(mockDb.deleteUser).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle non-existent user', async () => {
      // Setup
      mockEvent.httpMethod = 'DELETE';
      mockEvent.pathParameters = { userId };
      mockDb.deleteUser.mockRejectedValueOnce(new Error('User not found'));

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'User not found'
      }));
      expect(mockDb.cleanup).toHaveBeenCalled();
    });
  });

  describe('Unsupported methods', () => {
    it('should reject unsupported HTTP methods', async () => {
      // Setup
      mockEvent.httpMethod = 'PATCH';

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify
      expect(response.statusCode).toBe(405);
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        error: 'Method not allowed'
      }));
      expect(mockDb.cleanup).toHaveBeenCalled();
    });
  });
}); 
import { APIGatewayProxyEvent, Context, ScheduledEvent } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../../services/database';
import { handler } from '../../handlers/birthday';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send
    })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    mockSQSSend: send  // Export the mock function for test usage
  };
});

// Get the mock send function
const { mockSQSSend } = jest.requireMock('@aws-sdk/client-sqs');

// Mock DatabaseService
jest.mock('../../services/database', () => {
  const mockCleanup = jest.fn();
  const mockGetUsersWithBirthdayNow = jest.fn();
  const mockInstance = {
    cleanup: mockCleanup,
    getUsersWithBirthdayNow: mockGetUsersWithBirthdayNow
  };
  return {
    DatabaseService: {
      getInstance: jest.fn(() => mockInstance)
    }
  };
});

describe('Birthday Handler', () => {
  let mockDb: jest.Mocked<Pick<DatabaseService, 'getUsersWithBirthdayNow' | 'cleanup'>>;
  let mockEvent: Partial<APIGatewayProxyEvent> | Partial<ScheduledEvent>;
  let mockContext: Partial<Context>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mock database instance
    mockDb = (DatabaseService.getInstance() as unknown) as typeof mockDb;

    // Setup default mock event and context
    mockEvent = {
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      time: new Date().toISOString()
    };
    mockContext = {};

    // Set environment variables
    process.env.WEBHOOK_QUEUE_URL = 'https://sqs.test.amazonaws.com/test-queue';
  });

  describe('Scheduled Event', () => {
    it('should process users with birthdays and send SQS messages', async () => {
      // Setup mock data
      const mockUsers = [
        {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Setup mocks
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce(mockUsers);
      mockSQSSend.mockResolvedValueOnce({
        MessageId: 'test-message-id'
      });

      // Execute
      await handler(mockEvent as ScheduledEvent, mockContext as Context);

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify SQS calls
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
      expect(SendMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Hey, John Doe it\'s your birthday'
        })
      });
    });

    it('should handle database errors by rethrowing', async () => {
      // Setup mock error
      const dbError = new Error('Database connection failed');
      mockDb.getUsersWithBirthdayNow.mockRejectedValueOnce(dbError);

      // Execute and verify
      await expect(handler(mockEvent as ScheduledEvent, mockContext as Context))
        .rejects
        .toThrow('Database connection failed');

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify no SQS calls were made
      expect(mockSQSSend).not.toHaveBeenCalled();
      expect(SendMessageCommand).not.toHaveBeenCalled();
    });

    it('should handle case when no birthdays are found', async () => {
      // Setup mock to return empty array
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce([]);

      // Execute
      const response = await handler(mockEvent as ScheduledEvent, mockContext as Context);

      // Verify response is undefined (scheduled events don't return responses)
      expect(response).toBeUndefined();

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify no SQS calls were made
      expect(mockSQSSend).not.toHaveBeenCalled();
      expect(SendMessageCommand).not.toHaveBeenCalled();
    });

    it('should continue processing when SQS send fails for a user', async () => {
      // Setup mock data with two users
      const mockUsers = [
        {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: '456',
          firstName: 'Jane',
          lastName: 'Smith',
          birthday: new Date('1992-01-01'),
          location: 'America/New_York',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Setup mocks
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce(mockUsers);
      
      // First SQS send fails, second succeeds
      mockSQSSend
        .mockRejectedValueOnce(new Error('SQS send failed'))
        .mockResolvedValueOnce({ MessageId: 'test-message-id' });

      // Execute
      const response = await handler(mockEvent as ScheduledEvent, mockContext as Context);

      // Verify response is undefined (scheduled events don't return responses)
      expect(response).toBeUndefined();

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify SQS calls - should try both users
      expect(mockSQSSend).toHaveBeenCalledTimes(2);
      expect(SendMessageCommand).toHaveBeenCalledTimes(2);
      
      // Verify first SQS message
      expect(SendMessageCommand).toHaveBeenNthCalledWith(1, {
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Hey, John Doe it\'s your birthday'
        })
      });

      // Verify second SQS message
      expect(SendMessageCommand).toHaveBeenNthCalledWith(2, {
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '456',
          firstName: 'Jane',
          lastName: 'Smith',
          location: 'America/New_York',
          message: 'Hey, Jane Smith it\'s your birthday'
        })
      });
    });
  });

  describe('HTTP Event', () => {
    beforeEach(() => {
      // Setup HTTP event
      mockEvent = {
        httpMethod: 'POST',
        path: '/birthday/check',
        headers: {},
        body: null,
        pathParameters: {},
        queryStringParameters: null,
        isBase64Encoded: false
      } as APIGatewayProxyEvent;
    });

    it('should return success response with processed users', async () => {
      // Setup mock data
      const mockUsers = [
        {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Setup mocks
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce(mockUsers);
      mockSQSSend.mockResolvedValueOnce({
        MessageId: 'test-message-id'
      });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify response
      expect(response).toBeDefined();
      expect(response?.statusCode).toBe(200);
      expect(JSON.parse(response?.body || '{}')).toEqual({
        message: 'Successfully queued 1 birthday greetings',
        users: [{
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore'
        }]
      });

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify SQS calls
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
      expect(SendMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Hey, John Doe it\'s your birthday'
        })
      });
    });

    it('should return error response when database fails', async () => {
      // Setup mock error
      const dbError = new Error('Database connection failed');
      mockDb.getUsersWithBirthdayNow.mockRejectedValueOnce(dbError);

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify response
      expect(response).toBeDefined();
      expect(response?.statusCode).toBe(500);
      expect(JSON.parse(response?.body || '{}')).toEqual({
        error: 'Failed to process birthday greetings',
        details: 'Database connection failed'
      });

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify no SQS calls were made
      expect(mockSQSSend).not.toHaveBeenCalled();
      expect(SendMessageCommand).not.toHaveBeenCalled();
    });

    it('should handle case when no birthdays are found', async () => {
      // Setup mock to return empty array
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce([]);

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify response
      expect(response).toBeDefined();
      expect(response?.statusCode).toBe(200);
      expect(JSON.parse(response?.body || '{}')).toEqual({
        message: 'Successfully queued 0 birthday greetings',
        users: []
      });

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify no SQS calls were made
      expect(mockSQSSend).not.toHaveBeenCalled();
      expect(SendMessageCommand).not.toHaveBeenCalled();
    });

    it('should continue processing when SQS send fails for a user', async () => {
      // Setup mock data with two users
      const mockUsers = [
        {
          id: '123',
          firstName: 'John',
          lastName: 'Doe',
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: '456',
          firstName: 'Jane',
          lastName: 'Smith',
          birthday: new Date('1992-01-01'),
          location: 'America/New_York',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Setup mocks
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce(mockUsers);
      
      // First SQS send fails, second succeeds
      mockSQSSend
        .mockRejectedValueOnce(new Error('SQS send failed'))
        .mockResolvedValueOnce({ MessageId: 'test-message-id' });

      // Execute
      const response = await handler(mockEvent as APIGatewayProxyEvent, mockContext as Context);

      // Verify response
      expect(response).toBeDefined();
      expect(response?.statusCode).toBe(200);
      expect(JSON.parse(response?.body || '{}')).toEqual({
        message: 'Successfully queued 2 birthday greetings',
        users: [
          {
            id: '123',
            firstName: 'John',
            lastName: 'Doe',
            location: 'Asia/Singapore'
          },
          {
            id: '456',
            firstName: 'Jane',
            lastName: 'Smith',
            location: 'America/New_York'
          }
        ]
      });

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify SQS calls - should try both users
      expect(mockSQSSend).toHaveBeenCalledTimes(2);
      expect(SendMessageCommand).toHaveBeenCalledTimes(2);
      
      // Verify first SQS message
      expect(SendMessageCommand).toHaveBeenNthCalledWith(1, {
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Hey, John Doe it\'s your birthday'
        })
      });

      // Verify second SQS message
      expect(SendMessageCommand).toHaveBeenNthCalledWith(2, {
        QueueUrl: 'https://sqs.test.amazonaws.com/test-queue',
        MessageBody: JSON.stringify({
          userId: '456',
          firstName: 'Jane',
          lastName: 'Smith',
          location: 'America/New_York',
          message: 'Hey, Jane Smith it\'s your birthday'
        })
      });
    });
  });
}); 
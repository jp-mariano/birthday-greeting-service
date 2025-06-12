import { Context, ScheduledEvent } from 'aws-lambda';
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../../services/database';
import { handler, chunkArray } from '../../handlers/birthday';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send
    })),
    SendMessageBatchCommand: jest.fn().mockImplementation((input) => ({ input })),
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
  let mockEvent: Partial<ScheduledEvent>;
  let mockContext: Partial<Context>;
  let mockSendMessageBatchCommand: jest.Mock;

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

    // Setup SendMessageBatchCommand mock
    mockSendMessageBatchCommand = SendMessageBatchCommand as unknown as jest.Mock;
  });

  describe('Scheduled Event', () => {
    it('should process users with birthdays and send batched SQS messages', async () => {
      // Setup mock data with multiple users to test batching
      const mockUsers = Array.from({ length: 250 }, (_, i) => ({
        id: `user${i}`,
        firstName: `First${i}`,
        lastName: `Last${i}`,
        birthday: new Date('1990-01-01'),
        location: 'Asia/Singapore',
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // Setup mocks
      mockDb.getUsersWithBirthdayNow.mockResolvedValueOnce(mockUsers);
      mockSQSSend.mockResolvedValue({
        Successful: [{ Id: 'test-message-id' }],
        Failed: []
      });

      // Execute
      await handler(mockEvent as ScheduledEvent, mockContext as Context);

      // Verify database calls
      expect(mockDb.getUsersWithBirthdayNow).toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();

      // Verify SQS batch calls
      expect(mockSQSSend).toHaveBeenCalledTimes(1);
      expect(mockSendMessageBatchCommand).toHaveBeenCalledTimes(1);

      // Verify batch entries
      const batchCall = mockSendMessageBatchCommand.mock.calls[0][0];
      expect(batchCall.QueueUrl).toBe('https://sqs.test.amazonaws.com/test-queue');
      expect(batchCall.Entries).toHaveLength(2); // Two chunks: 200 users and 50 users
      
      // Verify first chunk
      expect(JSON.parse(batchCall.Entries[0].MessageBody).records).toHaveLength(200);
      expect(JSON.parse(batchCall.Entries[1].MessageBody).records).toHaveLength(50);
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
      expect(mockSendMessageBatchCommand).not.toHaveBeenCalled();
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
      expect(mockSendMessageBatchCommand).not.toHaveBeenCalled();
    });
  });

  describe('chunkArray utility', () => {
    it('should correctly chunk arrays', () => {
      const array = [1, 2, 3, 4, 5, 6, 7];
      const chunked = chunkArray(array, 3);
      expect(chunked).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it('should handle empty arrays', () => {
      const array: number[] = [];
      const chunked = chunkArray(array, 3);
      expect(chunked).toEqual([]);
    });

    it('should handle chunk size equal to array length', () => {
      const array = [1, 2, 3];
      const chunked = chunkArray(array, 3);
      expect(chunked).toEqual([[1, 2, 3]]);
    });

    it('should handle chunk size larger than array length', () => {
      const array = [1, 2];
      const chunked = chunkArray(array, 3);
      expect(chunked).toEqual([[1, 2]]);
    });
  });
}); 
import { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import { SQSClient, DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../../services/database';
import { handler } from '../../handlers/webhook';
import { ScheduledEvent } from 'aws-lambda';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send
    })),
    DeleteMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    GetQueueAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
    ReceiveMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    mockSQSSend: send  // Export the mock function for test usage
  };
});

// Get the mock send function
const { mockSQSSend } = jest.requireMock('@aws-sdk/client-sqs');

// Mock DatabaseService
jest.mock('../../services/database', () => {
  const mockCleanup = jest.fn();
  const mockUpdateLastGreetingSent = jest.fn();
  const mockInstance = {
    cleanup: mockCleanup,
    updateLastGreetingSent: mockUpdateLastGreetingSent
  };
  return {
    DatabaseService: {
      getInstance: jest.fn(() => mockInstance)
    }
  };
});

// Mock fetch API
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Webhook Handler', () => {
  let mockDb: jest.Mocked<Pick<DatabaseService, 'updateLastGreetingSent' | 'cleanup'>>;
  let mockContext: Partial<Context>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get the mock database instance
    mockDb = (DatabaseService.getInstance() as unknown) as typeof mockDb;

    // Setup default mock context
    mockContext = {};

    // Setup environment variables
    process.env.WEBHOOK_ENDPOINT = 'https://api.example.com/webhook';
    process.env.WEBHOOK_DLQ_URL = 'https://sqs.test.amazonaws.com/dlq';

    // Setup default fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200
    });
  });

  describe('SQS Event Processing', () => {
    it('should process webhook message successfully', async () => {
      // Setup mock SQS event
      const mockMessage = {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Hey, John Doe it\'s your birthday'
      };

      const mockSQSEvent: SQSEvent = {
        Records: [{
          messageId: 'test-message-id',
          receiptHandle: 'test-receipt',
          body: JSON.stringify(mockMessage),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
            ApproximateFirstReceiveTimestamp: '1234567890'
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:queue',
          awsRegion: 'us-east-1'
        }]
      };

      // Execute
      await handler(mockSQSEvent, mockContext as Context);

      // Verify webhook call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mockMessage)
        }
      );

      // Verify database calls
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledWith('123');
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle webhook failure and rethrow error', async () => {
      // Setup mock SQS event
      const mockMessage = {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Hey, John Doe it\'s your birthday'
      };

      const mockSQSEvent: SQSEvent = {
        Records: [{
          messageId: 'test-message-id',
          receiptHandle: 'test-receipt',
          body: JSON.stringify(mockMessage),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
            ApproximateFirstReceiveTimestamp: '1234567890'
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:queue',
          awsRegion: 'us-east-1'
        }]
      };

      // Setup webhook to fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      // Execute and verify error is thrown
      await expect(handler(mockSQSEvent, mockContext as Context))
        .rejects
        .toThrow('Webhook failed with status 500');

      // Verify webhook call was made
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mockMessage)
        }
      );

      // Verify database was not updated but was cleaned up
      expect(mockDb.updateLastGreetingSent).not.toHaveBeenCalled();
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle gracefully when user not found or greeting already sent', async () => {
      // Setup mock SQS event
      const mockMessage = {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Hey, John Doe it\'s your birthday'
      };

      const mockSQSEvent: SQSEvent = {
        Records: [{
          messageId: 'test-message-id',
          receiptHandle: 'test-receipt',
          body: JSON.stringify(mockMessage),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
            ApproximateFirstReceiveTimestamp: '1234567890'
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:queue',
          awsRegion: 'us-east-1'
        }]
      };

      // Setup database to fail with "already sent" error
      mockDb.updateLastGreetingSent.mockRejectedValueOnce(
        new Error('User not found or greeting already sent this year')
      );

      // Execute - should not throw
      await handler(mockSQSEvent, mockContext as Context);

      // Verify webhook call was made
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mockMessage)
        }
      );

      // Verify database calls
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledWith('123');
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should throw error when database update fails unexpectedly', async () => {
      // Setup mock SQS event
      const mockMessage = {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Hey, John Doe it\'s your birthday'
      };

      const mockSQSEvent: SQSEvent = {
        Records: [{
          messageId: 'test-message-id',
          receiptHandle: 'test-receipt',
          body: JSON.stringify(mockMessage),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
            ApproximateFirstReceiveTimestamp: '1234567890'
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:queue',
          awsRegion: 'us-east-1'
        }]
      };

      // Setup database to fail with unexpected error
      mockDb.updateLastGreetingSent.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      // Execute and verify error is thrown
      await expect(handler(mockSQSEvent, mockContext as Context))
        .rejects
        .toThrow('Database connection failed');

      // Verify webhook call was made successfully
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mockMessage)
        }
      );

      // Verify database calls
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledWith('123');
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should process multiple messages independently', async () => {
      // Setup mock SQS event with three messages
      const mockMessages = [
        {
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Hey, John Doe it\'s your birthday'
        },
        {
          userId: '456',
          firstName: 'Jane',
          lastName: 'Smith',
          location: 'America/New_York',
          message: 'Hey, Jane Smith it\'s your birthday'
        },
        {
          userId: '789',
          firstName: 'Bob',
          lastName: 'Johnson',
          location: 'Europe/London',
          message: 'Hey, Bob Johnson it\'s your birthday'
        }
      ];

      const mockSQSEvent: SQSEvent = {
        Records: mockMessages.map((msg, index) => ({
          messageId: `test-message-id-${index}`,
          receiptHandle: `test-receipt-${index}`,
          body: JSON.stringify(msg),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
            ApproximateFirstReceiveTimestamp: '1234567890'
          },
          messageAttributes: {},
          md5OfBody: `test-md5-${index}`,
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:region:account:queue',
          awsRegion: 'us-east-1'
        }))
      };

      // Setup mixed responses:
      // - First message: webhook succeeds, DB update succeeds
      // - Second message: webhook fails
      // - Third message: webhook succeeds, DB update fails with "already sent"
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200 })  // First message succeeds
        .mockResolvedValueOnce({ ok: false, status: 500 }) // Second message fails
        .mockResolvedValueOnce({ ok: true, status: 200 }); // Third message succeeds

      mockDb.updateLastGreetingSent
        .mockResolvedValueOnce(undefined) // First message DB update succeeds
        .mockRejectedValueOnce(new Error('User not found or greeting already sent this year')); // Third message DB update fails gracefully

      // Execute and verify second message causes error
      await expect(handler(mockSQSEvent, mockContext as Context))
        .rejects
        .toThrow('Webhook failed with status 500');

      // Verify all webhook calls were attempted
      expect(mockFetch).toHaveBeenCalledTimes(2); // Third message not reached due to second failing
      
      // Verify first webhook call
      expect(mockFetch).toHaveBeenNthCalledWith(1, 
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockMessages[0])
        }
      );

      // Verify second webhook call
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockMessages[1])
        }
      );

      // Verify database calls
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledTimes(1); // Only first message succeeded
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledWith('123');
      
      // Verify cleanup was called after each message attempt
      expect(mockDb.cleanup).toHaveBeenCalledTimes(2);
    });
  });

  describe('DLQ Retry Processing', () => {
    it('should successfully process a single message from DLQ', async () => {
      // Setup mock SQS event
      const mockMessage = {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Hey, John Doe it\'s your birthday'
      };

      // Mock SQS responses for DLQ operations
      mockSQSSend
        // First call - GetQueueAttributes to check if DLQ has messages
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '1'
          }
        })
        // Second call - ReceiveMessage to get the message
        .mockResolvedValueOnce({
          $metadata: {},
          Messages: [{
            MessageId: 'dlq-msg-1',
            ReceiptHandle: 'test-receipt-handle',
            Body: JSON.stringify(mockMessage),
            MD5OfBody: 'test-md5',
            Attributes: {
              ApproximateReceiveCount: '1',
              SentTimestamp: '1234567890',
              SenderId: 'AROAXXXXXXXXXXXXXXXXX:bob',
              ApproximateFirstReceiveTimestamp: '1234567890'
            }
          }]
        })
        // Third call - DeleteMessage after successful processing
        .mockResolvedValueOnce({
          $metadata: {}
        })
        // Fourth call - ReceiveMessage returns empty to break the loop
        .mockResolvedValueOnce({
          $metadata: {},
          Messages: []
        });

      // Create a properly typed mock context
      const mockEventContext: Context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: 'test',
        functionVersion: '1',
        invokedFunctionArn: 'arn:test',
        memoryLimitInMB: '128',
        awsRequestId: 'test-id',
        logGroupName: 'test-group',
        logStreamName: 'test-stream',
        getRemainingTimeInMillis: () => 1000,
        done: () => {},
        fail: () => {},
        succeed: () => {}
      };

      // Create a properly typed scheduled event
      const mockScheduledEvent: ScheduledEvent = {
        id: 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
        version: '0',
        account: '123456789012',
        region: 'us-east-1',
        detail: {},
        source: 'aws.events',
        time: new Date().toISOString(),
        'detail-type': 'Scheduled Event',
        resources: []
      };

      // Execute DLQ processing
      await handler(mockScheduledEvent, mockEventContext);

      // Verify DLQ operations
      expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        AttributeNames: ['ApproximateNumberOfMessages']
      });

      // Should be called twice - once for the message and once for empty response
      expect(ReceiveMessageCommand).toHaveBeenCalledTimes(2);
      expect(ReceiveMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30
      });

      expect(DeleteMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        ReceiptHandle: 'test-receipt-handle'
      });

      // Verify webhook was called
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...mockMessage,
            retryCount: 1  // Handler increments retryCount for DLQ messages
          })
        }
      );

      // Verify database operations
      expect(mockDb.updateLastGreetingSent).toHaveBeenCalledWith('123');
      expect(mockDb.cleanup).toHaveBeenCalled();
    });

    it('should handle empty DLQ gracefully', async () => {
      // Mock SQS responses for DLQ operations
      mockSQSSend
        // First call - GetQueueAttributes shows messages exist
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '1'
          }
        })
        // Second call - ReceiveMessage returns no messages
        .mockResolvedValueOnce({
          $metadata: {},
          Messages: []
        });

      // Create a properly typed mock context
      const mockEventContext: Context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: 'test',
        functionVersion: '1',
        invokedFunctionArn: 'arn:test',
        memoryLimitInMB: '128',
        awsRequestId: 'test-id',
        logGroupName: 'test-group',
        logStreamName: 'test-stream',
        getRemainingTimeInMillis: () => 1000,
        done: () => {},
        fail: () => {},
        succeed: () => {}
      };

      // Create a properly typed scheduled event
      const mockScheduledEvent: ScheduledEvent = {
        id: 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
        version: '0',
        account: '123456789012',
        region: 'us-east-1',
        detail: {},
        source: 'aws.events',
        time: new Date().toISOString(),
        'detail-type': 'Scheduled Event',
        resources: []
      };

      // Execute DLQ processing
      await handler(mockScheduledEvent, mockEventContext);

      // Verify DLQ operations were called
      expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        AttributeNames: ['ApproximateNumberOfMessages']
      });

      expect(ReceiveMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30
      });

      // Verify no further processing occurred
      expect(DeleteMessageCommand).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.updateLastGreetingSent).not.toHaveBeenCalled();
      expect(mockDb.cleanup).not.toHaveBeenCalled();
    });

    it('should handle undefined Messages in DLQ response', async () => {
      // Mock SQS responses for DLQ operations
      mockSQSSend
        // First call - GetQueueAttributes shows messages exist
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '1'
          }
        })
        // Second call - ReceiveMessage returns undefined Messages
        .mockResolvedValueOnce({
          $metadata: {}
          // Messages is undefined
        });

      // Create a properly typed mock context
      const mockEventContext: Context = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: 'test',
        functionVersion: '1',
        invokedFunctionArn: 'arn:test',
        memoryLimitInMB: '128',
        awsRequestId: 'test-id',
        logGroupName: 'test-group',
        logStreamName: 'test-stream',
        getRemainingTimeInMillis: () => 1000,
        done: () => {},
        fail: () => {},
        succeed: () => {}
      };

      // Create a properly typed scheduled event
      const mockScheduledEvent: ScheduledEvent = {
        id: 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
        version: '0',
        account: '123456789012',
        region: 'us-east-1',
        detail: {},
        source: 'aws.events',
        time: new Date().toISOString(),
        'detail-type': 'Scheduled Event',
        resources: []
      };

      // Execute DLQ processing
      await handler(mockScheduledEvent, mockEventContext);

      // Verify DLQ operations were called
      expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        AttributeNames: ['ApproximateNumberOfMessages']
      });

      expect(ReceiveMessageCommand).toHaveBeenCalledWith({
        QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30
      });

      // Verify no further processing occurred
      expect(DeleteMessageCommand).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.updateLastGreetingSent).not.toHaveBeenCalled();
      expect(mockDb.cleanup).not.toHaveBeenCalled();
    });
  });
}); 
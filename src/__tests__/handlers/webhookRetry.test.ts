import { Context, ScheduledEvent } from 'aws-lambda';
import { 
  GetQueueAttributesCommand, 
  ReceiveMessageCommand, 
  SendMessageCommand, 
  DeleteMessageCommand 
} from '@aws-sdk/client-sqs';
import { handler } from '../../handlers/webhookRetry';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send
    })),
    GetQueueAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
    ReceiveMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    DeleteMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    mockSQSSend: send
  };
});

// Get the mock send function
const { mockSQSSend } = jest.requireMock('@aws-sdk/client-sqs');

describe('Webhook Retry Handler', () => {
  let mockContext: Partial<Context>;
  let mockEvent: Partial<ScheduledEvent>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock context
    mockContext = {};

    // Setup default mock event
    mockEvent = {
      id: 'test-event',
      version: '0',
      account: '123456789012',
      region: 'us-east-1',
      detail: {},
      source: 'aws.events',
      time: new Date().toISOString(),
      'detail-type': 'Scheduled Event',
      resources: []
    };

    // Setup environment variables
    process.env.WEBHOOK_DLQ_URL = 'https://sqs.test.amazonaws.com/dlq';
    process.env.WEBHOOK_QUEUE_URL = 'https://sqs.test.amazonaws.com/queue';
  });

  it('should handle empty DLQ gracefully', async () => {
    // Setup mock response for GetQueueAttributes
    mockSQSSend.mockResolvedValueOnce({
      Attributes: {
        ApproximateNumberOfMessages: '0'
      }
    });

    await handler(mockEvent as ScheduledEvent, mockContext as Context);

    // Verify SQS operations
    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      AttributeNames: ['ApproximateNumberOfMessages']
    });

    // Verify no further operations were performed
    expect(ReceiveMessageCommand).not.toHaveBeenCalled();
    expect(SendMessageCommand).not.toHaveBeenCalled();
    expect(DeleteMessageCommand).not.toHaveBeenCalled();
  });

  it('should handle no messages received from DLQ', async () => {
    // Setup mock responses
    mockSQSSend
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '1'
        }
      })
      .mockResolvedValueOnce({
        Messages: []
      });

    await handler(mockEvent as ScheduledEvent, mockContext as Context);

    // Verify SQS operations
    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      AttributeNames: ['ApproximateNumberOfMessages']
    });

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 30
    });

    // Verify no further operations were performed
    expect(SendMessageCommand).not.toHaveBeenCalled();
    expect(DeleteMessageCommand).not.toHaveBeenCalled();
  });

  it('should process and redrive message successfully', async () => {
    const mockMessage = {
      MessageId: 'test-message-id',
      ReceiptHandle: 'test-receipt-handle',
      Body: JSON.stringify({
        records: [{
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Happy Birthday John!'
        }]
      }),
      Attributes: {
        ApproximateReceiveCount: '1'
      }
    };

    // Setup mock responses
    mockSQSSend
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '1'
        }
      })
      .mockResolvedValueOnce({
        Messages: [mockMessage]
      })
      .mockResolvedValueOnce({}) // SendMessage success
      .mockResolvedValueOnce({}); // DeleteMessage success

    await handler(mockEvent as ScheduledEvent, mockContext as Context);

    // Verify SQS operations
    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      AttributeNames: ['ApproximateNumberOfMessages']
    });

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 30
    });

    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/queue',
      MessageBody: mockMessage.Body
    });

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      ReceiptHandle: mockMessage.ReceiptHandle
    });
  });

  it('should handle send message failure gracefully', async () => {
    const mockMessage = {
      MessageId: 'test-message-id',
      ReceiptHandle: 'test-receipt-handle',
      Body: JSON.stringify({
        records: [{
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Happy Birthday John!'
        }]
      }),
      Attributes: {
        ApproximateReceiveCount: '1'
      }
    };

    // Setup mock responses
    mockSQSSend
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '1'
        }
      })
      .mockResolvedValueOnce({
        Messages: [mockMessage]
      })
      .mockRejectedValueOnce(new Error('Failed to send message')); // SendMessage fails

    await handler(mockEvent as ScheduledEvent, mockContext as Context);

    // Verify SQS operations
    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      AttributeNames: ['ApproximateNumberOfMessages']
    });

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 30
    });

    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/queue',
      MessageBody: mockMessage.Body
    });

    // Verify message was not deleted from DLQ
    expect(DeleteMessageCommand).not.toHaveBeenCalled();
  });

  it('should handle delete message failure gracefully', async () => {
    const mockMessage = {
      MessageId: 'test-message-id',
      ReceiptHandle: 'test-receipt-handle',
      Body: JSON.stringify({
        records: [{
          userId: '123',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Asia/Singapore',
          message: 'Happy Birthday John!'
        }]
      }),
      Attributes: {
        ApproximateReceiveCount: '1'
      }
    };

    // Setup mock responses
    mockSQSSend
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '1'
        }
      })
      .mockResolvedValueOnce({
        Messages: [mockMessage]
      })
      .mockResolvedValueOnce({}) // SendMessage success
      .mockRejectedValueOnce(new Error('Failed to delete message')); // DeleteMessage fails

    await handler(mockEvent as ScheduledEvent, mockContext as Context);

    // Verify all operations were attempted
    expect(GetQueueAttributesCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      AttributeNames: ['ApproximateNumberOfMessages']
    });

    expect(ReceiveMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 30
    });

    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/queue',
      MessageBody: mockMessage.Body
    });

    expect(DeleteMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      ReceiptHandle: mockMessage.ReceiptHandle
    });
  });
}); 
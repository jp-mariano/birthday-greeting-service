import { Context, SQSEvent } from 'aws-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { DatabaseService } from '../../services/database';
import { handler } from '../../handlers/webhook';

// Mock SQS client
jest.mock('@aws-sdk/client-sqs', () => {
  const send = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send
    })),
    SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
    mockSQSSend: send
  };
});

// Mock DatabaseService
jest.mock('../../services/database', () => {
  const mockCleanup = jest.fn();
  const mockCanSendGreeting = jest.fn();
  const mockUpdateLastGreetingSent = jest.fn();
  const mockInstance = {
    cleanup: mockCleanup,
    canSendGreeting: mockCanSendGreeting,
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
  let mockDb: jest.Mocked<Pick<DatabaseService, 'canSendGreeting' | 'updateLastGreetingSent' | 'cleanup'>>;
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

    // Setup default database mocks
    mockDb.canSendGreeting.mockResolvedValue(true);
    mockDb.updateLastGreetingSent.mockResolvedValue();
  });

  it('should reject events with no records or multiple records', async () => {
    const emptyEvent: SQSEvent = { Records: [] };
    const multiEvent: SQSEvent = {
      Records: [
        { body: '{}' } as any,
        { body: '{}' } as any
      ]
    };

    await expect(handler(emptyEvent, mockContext as Context))
      .rejects
      .toThrow('Expected exactly one record in SQS event');

    await expect(handler(multiEvent, mockContext as Context))
      .rejects
      .toThrow('Expected exactly one record in SQS event');
  });

  it('should reject messages without records array', async () => {
    const mockEvent: SQSEvent = {
      Records: [{
        body: JSON.stringify({ foo: 'bar' })
      } as any]
    };

    await expect(handler(mockEvent, mockContext as Context))
      .rejects
      .toThrow('Message format error: expected records array');
  });

  it('should process records successfully', async () => {
    const mockRecords = [
      {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Happy Birthday John!'
      },
      {
        userId: '456',
        firstName: 'Jane',
        lastName: 'Smith',
        location: 'America/New_York',
        message: 'Happy Birthday Jane!'
      }
    ];

    const mockEvent: SQSEvent = {
      Records: [{
        body: JSON.stringify({ records: mockRecords })
      } as any]
    };

    await handler(mockEvent, mockContext as Context);

    // Verify webhook calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://api.example.com/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockRecords[0])
      }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://api.example.com/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockRecords[1])
      }
    );

    // Verify database calls
    expect(mockDb.canSendGreeting).toHaveBeenCalledTimes(2);
    expect(mockDb.updateLastGreetingSent).toHaveBeenCalledTimes(2);
    expect(mockDb.cleanup).toHaveBeenCalledTimes(2);
  });

  it('should skip records that already received greetings', async () => {
    const mockRecords = [
      {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Happy Birthday John!'
      }
    ];

    const mockEvent: SQSEvent = {
      Records: [{
        body: JSON.stringify({ records: mockRecords })
      } as any]
    };

    mockDb.canSendGreeting.mockResolvedValueOnce(false);

    await handler(mockEvent, mockContext as Context);

    // Verify no webhook call was made
    expect(mockFetch).not.toHaveBeenCalled();
    
    // Verify database calls
    expect(mockDb.canSendGreeting).toHaveBeenCalledWith('123');
    expect(mockDb.updateLastGreetingSent).not.toHaveBeenCalled();
    expect(mockDb.cleanup).toHaveBeenCalled();
  });

  it('should send failed records to DLQ', async () => {
    const mockRecords = [
      {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Happy Birthday John!'
      }
    ];

    const mockEvent: SQSEvent = {
      Records: [{
        body: JSON.stringify({ records: mockRecords })
      } as any]
    };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    await handler(mockEvent, mockContext as Context);

    // Verify webhook call was attempted
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify message was sent to DLQ
    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MessageBody: JSON.stringify({
        records: [mockRecords[0]]
      })
    });

    // Verify database was not updated
    expect(mockDb.updateLastGreetingSent).not.toHaveBeenCalled();
    expect(mockDb.cleanup).toHaveBeenCalled();
  });

  it('should handle database errors by sending to DLQ', async () => {
    const mockRecords = [
      {
        userId: '123',
        firstName: 'John',
        lastName: 'Doe',
        location: 'Asia/Singapore',
        message: 'Happy Birthday John!'
      }
    ];

    const mockEvent: SQSEvent = {
      Records: [{
        body: JSON.stringify({ records: mockRecords })
      } as any]
    };

    mockDb.updateLastGreetingSent.mockRejectedValueOnce(new Error('Database error'));

    await handler(mockEvent, mockContext as Context);

    // Verify webhook call was made
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify message was sent to DLQ
    expect(SendMessageCommand).toHaveBeenCalledWith({
      QueueUrl: 'https://sqs.test.amazonaws.com/dlq',
      MessageBody: JSON.stringify({
        records: [mockRecords[0]]
      })
    });

    // Verify cleanup was still called
    expect(mockDb.cleanup).toHaveBeenCalled();
  });
}); 
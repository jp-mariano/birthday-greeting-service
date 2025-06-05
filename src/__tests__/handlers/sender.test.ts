import { DynamoDBService } from '../../services/dynamodb';
import { handler } from '../../handlers/sender';
import { BirthdayMessage, MessageLog } from '../../types/models';
import { Context } from 'aws-lambda';

// Mock the DynamoDB service
jest.mock('../../services/dynamodb');

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock dates for consistent testing
const mockDate = '2024-01-01';
const mockDateISO = `${mockDate}T00:00:00.000Z`;
jest.useFakeTimers().setSystemTime(new Date(mockDateISO));

// Mock environment variables
process.env.WEBHOOK_ENDPOINT = 'https://test-webhook.pipedream.net';

describe('Message Sender Handler', () => {
  let mockDynamoDBService: jest.Mocked<DynamoDBService>;

  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test',
    functionVersion: '1',
    invokedFunctionArn: 'test',
    memoryLimitInMB: '128',
    awsRequestId: 'test',
    logGroupName: 'test',
    logStreamName: 'test',
    getRemainingTimeInMillis: () => 1000,
    done: () => {},
    fail: () => {},
    succeed: () => {}
  };

  const validMessage: BirthdayMessage = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    firstName: 'John',
    lastName: 'Doe',
    location: 'America/New_York'
  };

  const mockMessageLog = (status: 'PENDING' | 'SENT' | 'FAILED'): MessageLog => ({
    messageId: `${validMessage.userId}_${mockDate}`,
    status,
    attempts: status === 'PENDING' ? 0 : 1,
    createdAt: mockDateISO,
    updatedAt: mockDateISO,
    ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh mock instance
    mockDynamoDBService = new DynamoDBService() as jest.Mocked<DynamoDBService>;

    // Mock the methods we'll use
    jest.spyOn(mockDynamoDBService, 'getMessageLog');
    jest.spyOn(mockDynamoDBService, 'createMessageLog');
    jest.spyOn(mockDynamoDBService, 'updateMessageStatus');
  });

  it('should process birthday message successfully', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('SENT'));
    mockFetch.mockResolvedValue({ ok: true });

    await handler(validMessage, mockContext, mockDynamoDBService);

    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledWith(validMessage.userId, mockDate);
    expect(mockDynamoDBService.updateMessageStatus).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`, 'SENT');
    expect(mockFetch).toHaveBeenCalledWith(process.env.WEBHOOK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(validMessage)
    });
  });

  it('should handle non-existent message log', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('SENT'));
    mockFetch.mockResolvedValue({ ok: true });

    await handler(validMessage, mockContext, mockDynamoDBService);

    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledWith(validMessage.userId, mockDate);
    expect(mockDynamoDBService.updateMessageStatus).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`, 'SENT');
    expect(mockFetch).toHaveBeenCalledWith(process.env.WEBHOOK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(validMessage)
    });
  });

  it('should handle DynamoDB errors', async () => {
    const error = new Error('Failed to update status');
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockRejectedValue(error);
    mockFetch.mockResolvedValue({ ok: true });

    await expect(handler(validMessage, mockContext, mockDynamoDBService))
      .rejects.toThrow('Failed to update status');

    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledWith(validMessage.userId, mockDate);
    expect(mockDynamoDBService.updateMessageStatus).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`, 'SENT');
  });

  it('should handle already processed messages', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('SENT'));

    await handler(validMessage, mockContext, mockDynamoDBService);

    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).not.toHaveBeenCalled();
    expect(mockDynamoDBService.updateMessageStatus).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle Hookbin API failures', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Internal Server Error' });

    await expect(handler(validMessage, mockContext, mockDynamoDBService))
      .rejects.toThrow('Failed to send message: Internal Server Error');

    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledWith(validMessage.userId, mockDate);
    expect(mockDynamoDBService.updateMessageStatus).not.toHaveBeenCalled();
  });

  it('should use default service instance when not provided', async () => {
    const defaultDbSpy = jest.spyOn(DynamoDBService.prototype, 'getMessageLog')
      .mockResolvedValue(null);
    const defaultDbCreateSpy = jest.spyOn(DynamoDBService.prototype, 'createMessageLog')
      .mockResolvedValue(mockMessageLog('PENDING'));
    const defaultDbUpdateSpy = jest.spyOn(DynamoDBService.prototype, 'updateMessageStatus')
      .mockResolvedValue(mockMessageLog('SENT'));
    mockFetch.mockResolvedValue({ ok: true });

    await handler(validMessage, mockContext);

    expect(defaultDbSpy).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`);
    expect(defaultDbCreateSpy).toHaveBeenCalledWith(validMessage.userId, mockDate);
    expect(mockFetch).toHaveBeenCalledWith(process.env.WEBHOOK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validMessage)
    });
    expect(defaultDbUpdateSpy).toHaveBeenCalledWith(`${validMessage.userId}_${mockDate}`, 'SENT');

    defaultDbSpy.mockRestore();
    defaultDbCreateSpy.mockRestore();
    defaultDbUpdateSpy.mockRestore();
  });
}); 
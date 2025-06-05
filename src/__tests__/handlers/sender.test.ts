import { DynamoDBService } from '../../services/dynamodb';
import { handler } from '../../handlers/sender';
import { BirthdayMessage, MessageLog } from '../../types/models';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock the DynamoDB service
jest.mock('../../services/dynamodb', () => {
  return {
    DynamoDBService: jest.fn().mockImplementation(() => ({
      getMessageLog: jest.fn(),
      createMessageLog: jest.fn(),
      updateMessageStatus: jest.fn()
    }))
  };
});

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock dates for consistent testing
const mockDate = '2024-01-01';
const mockDateISO = `${mockDate}T00:00:00.000Z`;
jest.useFakeTimers().setSystemTime(new Date(mockDateISO));

// Mock environment variables
process.env.WEBHOOK_ENDPOINT = 'https://test-webhook.pipedream.net';
process.env.IS_OFFLINE = 'true';

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

  const mockEvent: APIGatewayProxyEvent = {
    body: JSON.stringify(validMessage),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/send',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: ''
  };

  const mockMessageLog = (status: 'PENDING' | 'SENT' | 'FAILED', attempts: number = 0): MessageLog => ({
    messageId: `${validMessage.userId}_${mockDate}`,
    status,
    attempts,
    createdAt: mockDateISO,
    updatedAt: mockDateISO,
    ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
  });

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();

    // Reset DynamoDB mock
    mockDynamoDBService = new DynamoDBService() as jest.Mocked<DynamoDBService>;
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDynamoDBService);
  });

  it('should process birthday message successfully', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('SENT'));
    mockFetch.mockResolvedValue({ 
      ok: true, 
      status: 200,
      text: async () => 'Success!'
    });

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Birthday message sent successfully'
    });
    expect(console.log).toHaveBeenCalledWith('🎂 Sending birthday message:', expect.any(Object));
  });

  it('should handle invalid input data', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: JSON.stringify({ 
        userId: 'invalid-uuid',
        firstName: '',  // Invalid: empty string
        lastName: 'Doe',
        location: 'Invalid/Timezone'
      })
    };

    const response = await handler(invalidEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toHaveProperty('error');
    expect(JSON.parse(response.body)).toHaveProperty('details');
    expect(JSON.parse(response.body).details).toBeInstanceOf(Array);
  });

  it('should handle retry mechanism correctly', async () => {
    const networkError = new Error('Network error');
    mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('FAILED', 1));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('FAILED', 2));
    mockFetch.mockRejectedValue(networkError);

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: networkError.message
    });
  });

  it('should stop retrying after MAX_ATTEMPTS', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('FAILED', 3));

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Max retry attempts exceeded',
      details: 'Failed to send message after 3 attempts'
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle webhook response parsing', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('FAILED', 1));
    mockFetch.mockResolvedValue({ 
      ok: false, 
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: 'Webhook failed with status 500: Internal Server Error'
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('should handle missing event body', async () => {
    const invalidEvent = {
      ...mockEvent,
      body: null
    };

    const response = await handler(invalidEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toHaveProperty('error');
  });

  it('should handle already processed messages', async () => {
    mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('SENT'));

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: `Message ${validMessage.userId}_${mockDate} has already been sent`
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle DynamoDB errors gracefully', async () => {
    const dbError = new Error('DynamoDB error');
    mockDynamoDBService.getMessageLog.mockRejectedValue(dbError);

    const response = await handler(mockEvent, mockContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: dbError.message
    });
  });
}); 
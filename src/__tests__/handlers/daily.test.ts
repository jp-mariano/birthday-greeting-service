import { DynamoDBService } from '../../services/dynamodb';
import { SchedulerService } from '../../services/scheduler';
import { handler } from '../../handlers/daily';
import { Context, APIGatewayProxyEvent } from 'aws-lambda';
import { EventBridgeEvent } from 'aws-lambda';
import { User, MessageLog } from '../../types/models';

// Mock the services
jest.mock('../../services/dynamodb');
jest.mock('../../services/scheduler');

// Mock dates for consistent testing
const mockDate = '2024-01-01';
const mockDateISO = `${mockDate}T00:00:00.000Z`;
jest.useFakeTimers().setSystemTime(new Date(mockDateISO));

describe('Daily Aggregator Handler', () => {
  let mockDynamoDBService: jest.Mocked<DynamoDBService>;
  let mockSchedulerService: jest.Mocked<SchedulerService>;

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

  const mockEvent: EventBridgeEvent<'Scheduled Event', any> = {
    version: '0',
    id: 'test',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: 'test',
    time: mockDateISO,
    region: 'us-east-1',
    resources: ['test'],
    detail: {}
  };

  const mockUser: User = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    firstName: 'John',
    lastName: 'Doe',
    location: 'America/New_York',
    birthday: '1990-01-01',
    birthdayMD: '01-01',
    createdAt: mockDateISO,
    updatedAt: mockDateISO,
    sk: 'USER#metadata'
  };

  const mockMessageLog = (status: 'PENDING' | 'SENT' | 'FAILED'): MessageLog => ({
    messageId: `${mockUser.userId}_${mockDate}`,
    status,
    attempts: status === 'PENDING' ? 0 : 1,
    createdAt: mockDateISO,
    updatedAt: mockDateISO,
    ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the prototype before creating new mocks
    jest.restoreAllMocks();

    // Create fresh mock instances
    mockDynamoDBService = new DynamoDBService() as jest.Mocked<DynamoDBService>;
    mockSchedulerService = new SchedulerService() as jest.Mocked<SchedulerService>;

    // Mock the constructor to return our mock instance
    jest.spyOn(DynamoDBService.prototype, 'getTodaysBirthdays').mockImplementation(
      () => mockDynamoDBService.getTodaysBirthdays()
    );
    jest.spyOn(DynamoDBService.prototype, 'getMessageLog').mockImplementation(
      (messageId) => mockDynamoDBService.getMessageLog(messageId)
    );
    jest.spyOn(DynamoDBService.prototype, 'createMessageLog').mockImplementation(
      (userId, date) => mockDynamoDBService.createMessageLog(userId, date)
    );
    jest.spyOn(DynamoDBService.prototype, 'updateMessageStatus').mockImplementation(
      (messageId, status) => mockDynamoDBService.updateMessageStatus(messageId, status)
    );
    jest.spyOn(SchedulerService.prototype, 'scheduleMessage').mockImplementation(
      (message, date) => mockSchedulerService.scheduleMessage(message, date)
    );
  });

  it('should process users with birthdays today when no message log exists', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([mockUser]);
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockSchedulerService.scheduleMessage.mockResolvedValue();

    await handler(mockEvent, mockContext);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${mockUser.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledWith(mockUser.userId, mockDate);
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
      {
        userId: mockUser.userId,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        location: mockUser.location
      },
      mockDate
    );
  });

  it('should skip users that already have a message log', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([mockUser]);
    mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('PENDING'));

    await handler(mockEvent, mockContext);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${mockUser.userId}_${mockDate}`);
    expect(mockDynamoDBService.createMessageLog).not.toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
  });

  it('should handle multiple users with birthdays today', async () => {
    const mockUsers = [
      mockUser,
      {
        ...mockUser,
        userId: '223e4567-e89b-12d3-a456-426614174001',
        firstName: 'Jane',
        lastName: 'Smith',
        location: 'Europe/London'
      }
    ];

    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue(mockUsers);
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockImplementation(
      () => Promise.resolve(mockMessageLog('PENDING'))
    );
    mockSchedulerService.scheduleMessage.mockResolvedValue();

    await handler(mockEvent, mockContext);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledTimes(2);
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalledTimes(2);
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledTimes(2);
  });

  it('should handle empty birthday list', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([]);

    await handler(mockEvent, mockContext);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).not.toHaveBeenCalled();
    expect(mockDynamoDBService.createMessageLog).not.toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
  });

  it('should handle DynamoDB query errors', async () => {
    const error = new Error('DynamoDB error');
    mockDynamoDBService.getTodaysBirthdays.mockRejectedValue(error);

    await expect(handler(mockEvent, mockContext))
      .rejects.toThrow('DynamoDB error');

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).not.toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
  });

  it('should handle scheduler service errors and update message status', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([mockUser]);
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockDynamoDBService.updateMessageStatus.mockResolvedValue(mockMessageLog('FAILED'));
    
    const error = new Error('Scheduler error');
    mockSchedulerService.scheduleMessage.mockRejectedValue(error);

    await handler(mockEvent, mockContext);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockDynamoDBService.getMessageLog).toHaveBeenCalled();
    expect(mockDynamoDBService.createMessageLog).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalled();
    expect(mockDynamoDBService.updateMessageStatus).toHaveBeenCalledWith(
      `${mockUser.userId}_${mockDate}`,
      'FAILED'
    );
  });

  it('should handle HTTP requests and return appropriate response', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([mockUser]);
    mockDynamoDBService.getMessageLog.mockResolvedValue(null);
    mockDynamoDBService.createMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
    mockSchedulerService.scheduleMessage.mockResolvedValue();

    const mockHttpEvent: APIGatewayProxyEvent = {
      httpMethod: 'POST',
      path: '/birthday/daily',
      body: null,
      headers: {},
      multiValueHeaders: {},
      isBase64Encoded: false,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {
        accountId: '',
        apiId: '',
        authorizer: {},
        protocol: '',
        httpMethod: 'POST',
        identity: {
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          clientCert: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          sourceIp: '',
          user: null,
          userAgent: null,
          userArn: null
        },
        path: '',
        stage: '',
        requestId: '',
        requestTimeEpoch: 0,
        resourceId: '',
        resourcePath: ''
      },
      resource: ''
    };

    const result = await handler(mockHttpEvent, mockContext);

    expect(result).toEqual({
      statusCode: 200,
      body: JSON.stringify({
        message: 'Successfully processed 1 birthdays',
        users: [{
          userId: mockUser.userId,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          location: mockUser.location
        }]
      })
    });
  });
}); 
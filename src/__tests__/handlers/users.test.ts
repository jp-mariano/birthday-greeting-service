import { DynamoDBService } from '../../services/dynamodb';
import { SchedulerService } from '../../services/scheduler';
import { handler } from '../../handlers/users';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { User, MessageLog } from '../../types/models';

// Mock the services
jest.mock('../../services/dynamodb', () => {
  return {
    DynamoDBService: jest.fn().mockImplementation(() => ({
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      getMessageLog: jest.fn()
    }))
  };
});

jest.mock('../../services/scheduler', () => {
  return {
    SchedulerService: jest.fn().mockImplementation(() => ({
      scheduleMessage: jest.fn(),
      deleteSchedule: jest.fn()
    }))
  };
});

// Mock dates for consistent testing
const mockDate = '2024-01-01';
const mockDateISO = `${mockDate}T00:00:00.000Z`;
jest.useFakeTimers().setSystemTime(new Date(mockDateISO));

// Test data
const validUserData = {
  firstName: 'John',
  lastName: 'Doe',
  birthday: '1990-01-01', // Same as mockDate for testing birthday scheduling
  location: 'America/New_York'
};

describe('Users API Handler', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();

    // Reset service mocks
    mockDynamoDBService = new DynamoDBService() as jest.Mocked<DynamoDBService>;
    mockSchedulerService = new SchedulerService() as jest.Mocked<SchedulerService>;
    (DynamoDBService as jest.Mock).mockImplementation(() => mockDynamoDBService);
    (SchedulerService as jest.Mock).mockImplementation(() => mockSchedulerService);
  });

  const createMockEvent = (method: string, body?: any, pathParameters?: any): APIGatewayProxyEvent => ({
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    pathParameters,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: ''
  });

  const mockMessageLog = (status: 'PENDING' | 'SENT' | 'FAILED'): MessageLog => ({
    messageId: `test-user-id_${mockDate}`,
    status,
    attempts: status === 'PENDING' ? 0 : 1,
    createdAt: mockDateISO,
    updatedAt: mockDateISO,
    ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
  });

  describe('POST /users', () => {
    const createdUser: User = {
      userId: 'test-user-id',
      sk: 'USER#metadata',
      ...validUserData,
      birthdayMD: '01-01',
      createdAt: mockDateISO,
      updatedAt: mockDateISO
    };

    it('should create user successfully', async () => {
      const event = createMockEvent('POST', validUserData);
      mockDynamoDBService.createUser.mockResolvedValue(createdUser);
      mockSchedulerService.scheduleMessage.mockResolvedValue();

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(201);
      expect(JSON.parse(typedResponse.body)).toEqual(createdUser);
      expect(mockDynamoDBService.createUser).toHaveBeenCalledWith(validUserData);
      expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
        {
          userId: createdUser.userId,
          firstName: createdUser.firstName,
          lastName: createdUser.lastName,
          location: createdUser.location
        },
        mockDate
      );
    });

    it('should create user without scheduling if birthday is not today', async () => {
      const notTodayData = { ...validUserData, birthday: '1990-02-15' };
      const notTodayUser = { ...createdUser, birthday: '1990-02-15', birthdayMD: '02-15' };
      
      const event = createMockEvent('POST', notTodayData);
      mockDynamoDBService.createUser.mockResolvedValue(notTodayUser);

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(201);
      expect(JSON.parse(typedResponse.body)).toEqual(notTodayUser);
      expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('should handle scheduler service errors', async () => {
      const event = createMockEvent('POST', validUserData);
      mockDynamoDBService.createUser.mockResolvedValue(createdUser);
      mockSchedulerService.scheduleMessage.mockRejectedValue(new Error('Failed to create schedule'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(500);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Internal server error'
      });
    });

    it('should handle validation errors', async () => {
      const event = createMockEvent('POST', { ...validUserData, birthday: 'invalid-date' });

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(400);
      expect(JSON.parse(typedResponse.body)).toHaveProperty('error');
      expect(JSON.parse(typedResponse.body)).toHaveProperty('details');
    });

    it('should handle invalid JSON in request body', async () => {
      const event = {
        ...createMockEvent('POST'),
        body: 'invalid json'
      };

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(400);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Invalid JSON in request body'
      });
    });

    it('should handle user already exists error', async () => {
      const event = createMockEvent('POST', validUserData);
      mockDynamoDBService.createUser.mockRejectedValue(new Error('User with ID test-user-id already exists'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(409);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'User with ID test-user-id already exists'
      });
    });
  });

  describe('PUT /users/{userId}', () => {
    const userId = 'test-user-id';
    const validUpdates = {
      firstName: 'Jane',
      lastName: 'Doe',
      birthday: '1990-02-15',
      location: 'Europe/London'
    };

    const updatedUser: User = {
      userId,
      sk: 'USER#metadata',
      ...validUpdates,
      birthdayMD: '02-15',
      createdAt: mockDateISO,
      updatedAt: mockDateISO
    };

    it('should update user successfully', async () => {
      const event = createMockEvent('PUT', validUpdates, { userId });
      mockDynamoDBService.updateUser.mockResolvedValue(updatedUser);
      mockDynamoDBService.getMessageLog.mockResolvedValue(null);

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(200);
      expect(JSON.parse(typedResponse.body)).toEqual(updatedUser);
      expect(mockDynamoDBService.updateUser).toHaveBeenCalledWith(userId, validUpdates);
      expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${userId}_${mockDate}`);
      expect(mockSchedulerService.deleteSchedule).not.toHaveBeenCalled();
    });

    it('should handle scheduler service errors when deleting schedule', async () => {
      const event = createMockEvent('PUT', validUpdates, { userId });
      mockDynamoDBService.updateUser.mockResolvedValue(updatedUser);
      mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
      mockSchedulerService.deleteSchedule.mockRejectedValue(new Error('Failed to delete schedule'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(500);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Internal server error'
      });
    });

    it('should delete existing schedule when updating user', async () => {
      const event = createMockEvent('PUT', validUpdates, { userId });
      mockDynamoDBService.updateUser.mockResolvedValue(updatedUser);
      mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
      mockSchedulerService.deleteSchedule.mockResolvedValue();

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(200);
      expect(JSON.parse(typedResponse.body)).toEqual(updatedUser);
      expect(mockDynamoDBService.updateUser).toHaveBeenCalledWith(userId, validUpdates);
      expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${userId}_${mockDate}`);
      expect(mockSchedulerService.deleteSchedule).toHaveBeenCalledWith(userId, mockDate);
    });

    it('should handle missing userId parameter', async () => {
      const event = createMockEvent('PUT', validUpdates);

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(400);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Missing userId parameter'
      });
    });

    it('should handle non-existent user', async () => {
      const event = createMockEvent('PUT', validUpdates, { userId });
      mockDynamoDBService.updateUser.mockRejectedValue(new Error('User not found'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(404);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'User not found'
      });
    });

    it('should handle validation errors', async () => {
      const event = createMockEvent('PUT', { ...validUpdates, birthday: 'invalid-date' }, { userId });

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(400);
      expect(JSON.parse(typedResponse.body)).toHaveProperty('error');
      expect(JSON.parse(typedResponse.body)).toHaveProperty('details');
    });
  });

  describe('DELETE /users/{userId}', () => {
    const userId = 'test-user-id';

    it('should delete user successfully', async () => {
      const event = createMockEvent('DELETE', null, { userId });
      mockDynamoDBService.deleteUser.mockResolvedValue();
      mockDynamoDBService.getMessageLog.mockResolvedValue(null);

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(204);
      expect(mockDynamoDBService.deleteUser).toHaveBeenCalledWith(userId);
      expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${userId}_${mockDate}`);
      expect(mockSchedulerService.deleteSchedule).not.toHaveBeenCalled();
    });

    it('should handle missing userId parameter', async () => {
      const event = createMockEvent('DELETE');

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(400);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Missing userId parameter'
      });
    });

    it('should handle non-existent user', async () => {
      const event = createMockEvent('DELETE', null, { userId });
      mockDynamoDBService.deleteUser.mockRejectedValue(new Error('User not found'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(404);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'User not found'
      });
    });

    it('should handle scheduler service errors when deleting schedule', async () => {
      const event = createMockEvent('DELETE', null, { userId });
      mockDynamoDBService.deleteUser.mockResolvedValue();
      mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
      mockSchedulerService.deleteSchedule.mockRejectedValue(new Error('Failed to delete schedule'));

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(500);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Internal server error'
      });
    });

    it('should delete existing schedule when deleting user', async () => {
      const event = createMockEvent('DELETE', null, { userId });
      mockDynamoDBService.deleteUser.mockResolvedValue();
      mockDynamoDBService.getMessageLog.mockResolvedValue(mockMessageLog('PENDING'));
      mockSchedulerService.deleteSchedule.mockResolvedValue();

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(204);
      expect(mockDynamoDBService.deleteUser).toHaveBeenCalledWith(userId);
      expect(mockDynamoDBService.getMessageLog).toHaveBeenCalledWith(`${userId}_${mockDate}`);
      expect(mockSchedulerService.deleteSchedule).toHaveBeenCalledWith(userId, mockDate);
    });
  });

  describe('Unsupported Methods', () => {
    it('should return 405 for unsupported methods', async () => {
      const event = createMockEvent('PATCH');

      const response = await handler(event, mockContext);
      const typedResponse = response as APIGatewayProxyResult;

      expect(typedResponse.statusCode).toBe(405);
      expect(JSON.parse(typedResponse.body)).toEqual({
        error: 'Method not allowed'
      });
    });
  });
}); 
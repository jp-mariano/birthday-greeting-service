import { DynamoDBService } from '../../services/dynamodb';
import { SchedulerService } from '../../services/scheduler';
import { handler } from '../../handlers/daily';
import { Context } from 'aws-lambda';
import { EventBridgeEvent } from 'aws-lambda';
import { User } from '../../types/models';

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

  beforeEach(() => {
    jest.clearAllMocks();

    // Create fresh mock instances
    mockDynamoDBService = new DynamoDBService() as jest.Mocked<DynamoDBService>;
    mockSchedulerService = new SchedulerService() as jest.Mocked<SchedulerService>;

    // Mock the methods we'll use
    jest.spyOn(mockDynamoDBService, 'getTodaysBirthdays');
    jest.spyOn(mockSchedulerService, 'scheduleMessage');
  });

  it('should process users with birthdays today', async () => {
    const mockUsers: User[] = [
      {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        firstName: 'John',
        lastName: 'Doe',
        location: 'America/New_York',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        createdAt: mockDateISO,
        updatedAt: mockDateISO,
        sk: 'USER#metadata'
      }
    ];

    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue(mockUsers);
    mockSchedulerService.scheduleMessage.mockResolvedValue();

    await handler(mockEvent, mockContext, mockDynamoDBService, mockSchedulerService);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledWith(
      {
        userId: mockUsers[0].userId,
        firstName: mockUsers[0].firstName,
        lastName: mockUsers[0].lastName,
        location: mockUsers[0].location
      },
      mockDate
    );
  });

  it('should handle multiple users with birthdays today', async () => {
    const mockUsers: User[] = [
      {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        firstName: 'John',
        lastName: 'Doe',
        location: 'America/New_York',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        createdAt: mockDateISO,
        updatedAt: mockDateISO,
        sk: 'USER#metadata'
      },
      {
        userId: '223e4567-e89b-12d3-a456-426614174001',
        firstName: 'Jane',
        lastName: 'Smith',
        location: 'Europe/London',
        birthday: '1995-01-01',
        birthdayMD: '01-01',
        createdAt: mockDateISO,
        updatedAt: mockDateISO,
        sk: 'USER#metadata'
      }
    ];

    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue(mockUsers);
    mockSchedulerService.scheduleMessage.mockResolvedValue();

    await handler(mockEvent, mockContext, mockDynamoDBService, mockSchedulerService);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalledTimes(2);
    expect(mockSchedulerService.scheduleMessage).toHaveBeenNthCalledWith(1, 
      {
        userId: mockUsers[0].userId,
        firstName: mockUsers[0].firstName,
        lastName: mockUsers[0].lastName,
        location: mockUsers[0].location
      },
      mockDate
    );
    expect(mockSchedulerService.scheduleMessage).toHaveBeenNthCalledWith(2, 
      {
        userId: mockUsers[1].userId,
        firstName: mockUsers[1].firstName,
        lastName: mockUsers[1].lastName,
        location: mockUsers[1].location
      },
      mockDate
    );
  });

  it('should handle empty birthday list', async () => {
    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue([]);

    await handler(mockEvent, mockContext, mockDynamoDBService, mockSchedulerService);

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
  });

  it('should handle DynamoDB query errors', async () => {
    const error = new Error('DynamoDB error');
    mockDynamoDBService.getTodaysBirthdays.mockRejectedValue(error);

    await expect(handler(mockEvent, mockContext, mockDynamoDBService, mockSchedulerService))
      .rejects.toThrow('DynamoDB error');

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).not.toHaveBeenCalled();
  });

  it('should handle scheduler service errors', async () => {
    const mockUsers: User[] = [
      {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        firstName: 'John',
        lastName: 'Doe',
        location: 'America/New_York',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        createdAt: mockDateISO,
        updatedAt: mockDateISO,
        sk: 'USER#metadata'
      }
    ];

    mockDynamoDBService.getTodaysBirthdays.mockResolvedValue(mockUsers);
    const error = new Error('Scheduler error');
    mockSchedulerService.scheduleMessage.mockRejectedValue(error);

    await expect(handler(mockEvent, mockContext, mockDynamoDBService, mockSchedulerService))
      .rejects.toThrow('Scheduler error');

    expect(mockDynamoDBService.getTodaysBirthdays).toHaveBeenCalled();
    expect(mockSchedulerService.scheduleMessage).toHaveBeenCalled();
  });

  it('should use default service instances when not provided', async () => {
    const defaultDbSpy = jest.spyOn(DynamoDBService.prototype, 'getTodaysBirthdays')
      .mockResolvedValue([{
        userId: 'test-user-id',
        firstName: 'John',
        lastName: 'Doe',
        location: 'America/New_York',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        createdAt: mockDateISO,
        updatedAt: mockDateISO,
        sk: 'USER#metadata'
      }]);
    const defaultSchedulerSpy = jest.spyOn(SchedulerService.prototype, 'scheduleMessage')
      .mockResolvedValue();

    await handler(mockEvent, mockContext);

    expect(defaultDbSpy).toHaveBeenCalled();
    expect(defaultSchedulerSpy).toHaveBeenCalledWith({
      userId: 'test-user-id',
      firstName: 'John',
      lastName: 'Doe',
      location: 'America/New_York'
    }, mockDate);

    defaultDbSpy.mockRestore();
    defaultSchedulerSpy.mockRestore();
  });
}); 
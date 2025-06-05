import { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBService } from '../../services/dynamodb';
import { User } from '../../types/models';
import { DateTime } from 'luxon';

// Mock the DynamoDB client
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    config: {}
  }))
}));

// Mock dates for consistent testing
const mockDate = '2024-01-01T00:00:00.000Z';
const mockDateISO = DateTime.fromISO(mockDate).toISO();
jest.useFakeTimers().setSystemTime(new Date(mockDate));

describe('DynamoDBService', () => {
  let service: DynamoDBService;
  let mockClient: jest.Mocked<Pick<DynamoDBDocumentClient, 'send'>>;

  beforeEach(() => {
    mockClient = {
      send: jest.fn().mockImplementation(() => Promise.resolve({}))
    };
    service = new DynamoDBService(mockClient as unknown as DynamoDBDocumentClient);
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  describe('Constructor', () => {
    beforeEach(() => {
      delete process.env.DYNAMODB_ENDPOINT;
      delete process.env.AWS_REGION;
      delete process.env.USERS_TABLE;
      delete process.env.MESSAGE_LOGS_TABLE;
      (DynamoDBClient as jest.Mock).mockClear();
    });

    it('should initialize with default configuration', () => {
      new DynamoDBService();
      
      expect(DynamoDBClient).toHaveBeenCalledWith({
        region: 'us-east-1'
      });
    });

    it('should initialize with LocalStack configuration', () => {
      process.env.DYNAMODB_ENDPOINT = 'http://localhost:4566';
      
      new DynamoDBService();
      
      expect(DynamoDBClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test'
        }
      });
    });

    it('should use custom region when provided', () => {
      process.env.AWS_REGION = 'eu-west-1';
      
      new DynamoDBService();
      
      expect(DynamoDBClient).toHaveBeenCalledWith({
        region: 'eu-west-1'
      });
    });

    it('should use custom table names when provided', () => {
      process.env.USERS_TABLE = 'custom-users-table';
      process.env.MESSAGE_LOGS_TABLE = 'custom-logs-table';
      
      const customService = new DynamoDBService();
      
      expect((customService as any).usersTable).toBe('custom-users-table');
      expect((customService as any).logsTable).toBe('custom-logs-table');
    });
  });

  describe('createUser', () => {
    const validUserData = {
      firstName: 'John',
      lastName: 'Doe',
      birthday: '1990-01-15',
      location: 'America/New_York'
    };

    it('should create a user successfully', async () => {
      const expectedUser: User = {
        ...validUserData,
        userId: expect.any(String),
        sk: 'USER#metadata',
        birthdayMD: '01-15',
        createdAt: mockDate,
        updatedAt: mockDate
      };

      const result = await service.createUser(validUserData);

      expect(result).toMatchObject(expectedUser);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(PutCommand));
    });

    it('should throw error for invalid location', async () => {
      await expect(service.createUser({
        ...validUserData,
        location: 'Invalid/Timezone'
      })).rejects.toThrow('Invalid location');
    });

    it('should throw error for invalid birthday format', async () => {
      await expect(service.createUser({
        ...validUserData,
        birthday: '1990/01/15'
      })).rejects.toThrow('Invalid birthday');
    });

    it('should handle ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.createUser(validUserData))
        .rejects.toThrow('User with ID');
    });

    it('should handle non-ConditionalCheckFailedException errors', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.createUser(validUserData))
        .rejects.toThrow('Network error');
    });
  });

  describe('updateUser', () => {
    const userId = 'test-user-id';
    const validUpdates = {
      firstName: 'John',
      lastName: 'Doe'
    };

    it('should update user successfully', async () => {
      const expectedUser = {
        userId,
        firstName: validUpdates.firstName,
        lastName: validUpdates.lastName,
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        location: 'America/New_York',
        sk: 'USER#metadata',
        createdAt: mockDateISO,
        updatedAt: mockDateISO
      };

      mockClient.send.mockImplementationOnce(() => Promise.resolve({
        Attributes: expectedUser
      }));

      const result = await service.updateUser(userId, validUpdates);

      expect(result).toEqual(expectedUser);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(UpdateCommand));
    });

    it('should handle empty updates', async () => {
      const expectedUser = {
        userId,
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        location: 'America/New_York',
        sk: 'USER#metadata',
        createdAt: mockDateISO,
        updatedAt: mockDateISO
      };

      mockClient.send.mockImplementationOnce(() => Promise.resolve({
        Attributes: expectedUser
      }));

      const result = await service.updateUser(userId, {});

      expect(result).toEqual(expectedUser);
      expect(mockClient.send).toHaveBeenCalledWith(new UpdateCommand({
        TableName: expect.any(String),
        Key: { userId, sk: 'USER#metadata' },
        UpdateExpression: 'SET #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':updatedAt': mockDate
        },
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(userId) AND attribute_exists(sk)'
      }));
    });

    it('should throw error for invalid location', async () => {
      await expect(service.updateUser(userId, {
        ...validUpdates,
        location: 'Invalid/Timezone'
      })).rejects.toThrow('Invalid location');
    });

    it('should throw error for invalid birthday format', async () => {
      await expect(service.updateUser(userId, {
        ...validUpdates,
        birthday: '1990/01/15'
      })).rejects.toThrow('Invalid birthday');
    });

    it('should throw error for non-existent user', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.updateUser(userId, validUpdates))
        .rejects.toThrow('User test-user-id not found');
    });

    it('should throw error when no attributes returned', async () => {
      mockClient.send.mockImplementationOnce(() => Promise.resolve({
        Attributes: null
      }));

      await expect(service.updateUser(userId, validUpdates))
        .rejects.toThrow('User test-user-id not found');
    });

    it('should handle non-ConditionalCheckFailedException errors', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.updateUser(userId, validUpdates))
        .rejects.toThrow('Network error');
    });
  });

  describe('deleteUser', () => {
    const userId = 'test-user-id';

    it('should delete user successfully', async () => {
      await service.deleteUser(userId);

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(DeleteCommand));
    });

    it('should throw error for non-existent user', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.deleteUser(userId))
        .rejects.toThrow('User test-user-id not found');
    });

    it('should handle non-ConditionalCheckFailedException errors', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.deleteUser(userId))
        .rejects.toThrow('Network error');
    });
  });

  describe('getTodaysBirthdays', () => {
    it('should return users with birthdays today', async () => {
      const mockUsers = [{
        userId: 'test-user-id',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-01',
        birthdayMD: '01-01',
        location: 'America/New_York',
        sk: 'USER#metadata',
        createdAt: mockDateISO,
        updatedAt: mockDateISO
      }];

      mockClient.send.mockImplementationOnce(() => Promise.resolve({
        Items: mockUsers
      }));

      const result = await service.getTodaysBirthdays();

      expect(result).toEqual(mockUsers);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(QueryCommand));
      expect(console.log).toHaveBeenCalledWith('Getting today\'s birthdays...');
      expect(console.log).toHaveBeenCalledWith('Looking for birthdays on:', '01-01');
      expect(console.log).toHaveBeenCalledWith('Query result:', expect.any(String));
    });

    it('should return empty array when no birthdays found', async () => {
      mockClient.send.mockImplementationOnce(() => Promise.resolve({
        Items: []
      }));

      const result = await service.getTodaysBirthdays();

      expect(result).toEqual([]);
      expect(console.log).toHaveBeenCalledWith('Query result:', JSON.stringify({ Items: [] }, null, 2));
    });

    it('should handle query errors', async () => {
      const error = new Error('Query failed');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.getTodaysBirthdays())
        .rejects.toThrow('Query failed');
      expect(console.error).toHaveBeenCalledWith('Error querying birthdays:', error);
    });
  });
}); 
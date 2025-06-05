import { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBService } from '../../services/dynamodb';
import { User } from '../../types/models';
import { DateTime } from 'luxon';

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

    it('should handle non-ConditionalCheckFailedException errors in createUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.createUser({
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-01',
        location: 'America/New_York'
      })).rejects.toThrow('Network error');
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

    it('should handle non-ConditionalCheckFailedException errors in updateUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.updateUser('test-user-id', {
        firstName: 'John',
        lastName: 'Doe'
      })).rejects.toThrow('Network error');
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

    it('should handle non-ConditionalCheckFailedException errors in deleteUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.deleteUser('test-user-id'))
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
    });

    it('should return empty array when no birthdays found', async () => {
      const result = await service.getTodaysBirthdays();

      expect(result).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-ConditionalCheckFailedException errors in createUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.createUser({
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-01',
        location: 'America/New_York'
      })).rejects.toThrow('Network error');
    });

    it('should handle non-ConditionalCheckFailedException errors in updateUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.updateUser('test-user-id', {
        firstName: 'John',
        lastName: 'Doe'
      })).rejects.toThrow('Network error');
    });

    it('should handle non-ConditionalCheckFailedException errors in deleteUser', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.deleteUser('test-user-id'))
        .rejects.toThrow('Network error');
    });

    it('should handle non-ConditionalCheckFailedException errors in createMessageLog', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.createMessageLog('test-user-id', '2024-01-01'))
        .rejects.toThrow('Network error');
    });

    it('should handle non-ConditionalCheckFailedException errors in updateMessageStatus', async () => {
      const error = new Error('Network error');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.updateMessageStatus('test-user-id_2024-01-01', 'SENT'))
        .rejects.toThrow('Network error');
    });
  });
}); 
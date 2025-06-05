import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBService } from '../../services/dynamodb';
import { MessageLog } from '../../types/models';
import { DateTime } from 'luxon';

// Mock dates for consistent testing
const mockDate = '2024-01-01T00:00:00.000Z';
jest.useFakeTimers().setSystemTime(new Date(mockDate));

describe('DynamoDBService - Message Logs', () => {
  let service: DynamoDBService;
  let mockClient: jest.Mocked<DynamoDBDocumentClient>;
  let mockTableName: string;

  beforeEach(() => {
    mockTableName = 'test-logs-table';
    mockClient = {
      send: jest.fn()
    } as unknown as jest.Mocked<DynamoDBDocumentClient>;
    service = new DynamoDBService(mockClient);
    (service as any).logsTable = mockTableName;
    jest.clearAllMocks();
  });

  describe('createMessageLog', () => {
    const userId = 'test-user-id';
    const date = '2024-01-01';

    it('should create a message log successfully', async () => {
      const expectedLog: MessageLog = {
        messageId: `${userId}_${date}`,
        status: 'PENDING',
        attempts: 0,
        createdAt: mockDate,
        updatedAt: mockDate,
        ttl: Math.floor(DateTime.fromISO(date).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds())
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({});

      const result = await service.createMessageLog(userId, date);

      expect(result).toEqual(expectedLog);
      expect(mockClient.send).toHaveBeenCalledWith(new PutCommand({
        TableName: mockTableName,
        Item: expectedLog,
        ConditionExpression: 'attribute_not_exists(messageId)'
      }));
    });

    it('should calculate TTL correctly for different dates', async () => {
      const testDate = '2024-06-15';
      const expectedTTL = Math.floor(DateTime.fromISO(testDate).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds());

      (mockClient.send as jest.Mock).mockResolvedValueOnce({});
      const result = await service.createMessageLog(userId, testDate);

      expect(result.ttl).toBe(expectedTTL);
    });

    it('should throw error for invalid date format', async () => {
      await expect(service.createMessageLog(userId, '2024/01/01'))
        .rejects.toThrow('Invalid date');
    });

    it('should handle ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.createMessageLog(userId, date))
        .rejects.toThrow('Message log already exists');
    });

    it('should handle error message ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailedException');
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.createMessageLog(userId, date))
        .rejects.toThrow('Message log already exists');
    });

    it('should handle other errors', async () => {
      const error = new Error('Network error');
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.createMessageLog(userId, date))
        .rejects.toThrow('Network error');
    });
  });

  describe('getMessageLog', () => {
    const messageId = 'test-message-id';

    it('should get message log successfully', async () => {
      const mockLog: MessageLog = {
        messageId,
        status: 'PENDING',
        attempts: 0,
        createdAt: mockDate,
        updatedAt: mockDate,
        ttl: Math.floor(DateTime.fromISO(mockDate).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds())
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Item: mockLog
      });

      const result = await service.getMessageLog(messageId);

      expect(result).toEqual(mockLog);
      expect(mockClient.send).toHaveBeenCalledWith(new GetCommand({
        TableName: mockTableName,
        Key: { messageId }
      }));
    });

    it('should return null when message log not found', async () => {
      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Item: null
      });

      const result = await service.getMessageLog(messageId);

      expect(result).toBeNull();
    });

    it('should handle errors', async () => {
      const error = new Error('Network error');
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.getMessageLog(messageId))
        .rejects.toThrow('Network error');
    });
  });

  describe('updateMessageStatus', () => {
    const messageId = 'test-message-id';

    it('should update message status successfully', async () => {
      const expectedLog: MessageLog = {
        messageId,
        status: 'SENT',
        attempts: 1,
        createdAt: mockDate,
        updatedAt: mockDate,
        ttl: Math.floor(DateTime.fromISO(mockDate).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds())
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Attributes: expectedLog
      });

      const result = await service.updateMessageStatus(messageId, 'SENT');

      expect(result).toEqual(expectedLog);
      expect(mockClient.send).toHaveBeenCalledWith(new UpdateCommand({
        TableName: mockTableName,
        Key: { messageId },
        UpdateExpression: 'SET #status = :status, #attempts = #attempts + :increment, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#attempts': 'attempts',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'SENT',
          ':increment': 1,
          ':now': mockDate
        },
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(messageId)'
      }));
    });

    it('should throw error for non-existent message', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.updateMessageStatus(messageId, 'SENT'))
        .rejects.toThrow('Message test-message-id not found');
    });

    it('should throw error when no attributes returned', async () => {
      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Attributes: null
      });

      await expect(service.updateMessageStatus(messageId, 'SENT'))
        .rejects.toThrow('Message test-message-id not found');
    });

    it('should handle other errors', async () => {
      const error = new Error('Network error');
      (mockClient.send as jest.Mock).mockRejectedValueOnce(error);

      await expect(service.updateMessageStatus(messageId, 'SENT'))
        .rejects.toThrow('Network error');
    });

    it('should update attempts counter', async () => {
      const expectedLog: MessageLog = {
        messageId,
        status: 'FAILED',
        attempts: 2,
        createdAt: mockDate,
        updatedAt: mockDate,
        ttl: Math.floor(DateTime.fromISO(mockDate).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds())
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Attributes: expectedLog
      });

      const result = await service.updateMessageStatus(messageId, 'FAILED');

      expect(result.attempts).toBe(2);
      expect(mockClient.send).toHaveBeenCalledWith(new UpdateCommand({
        TableName: mockTableName,
        Key: { messageId },
        UpdateExpression: 'SET #status = :status, #attempts = #attempts + :increment, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#attempts': 'attempts',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':increment': 1,
          ':now': mockDate
        },
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(messageId)'
      }));
    });
  });
}); 
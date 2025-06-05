import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBService } from '../../services/dynamodb';
import { MessageLog } from '../../types/models';

// Mock dates for consistent testing
const mockDate = '2024-01-01T00:00:00.000Z';
jest.useFakeTimers().setSystemTime(new Date(mockDate));

describe('DynamoDBService - Message Logs', () => {
  let service: DynamoDBService;
  let mockClient: jest.Mocked<DynamoDBDocumentClient>;

  beforeEach(() => {
    mockClient = {
      send: jest.fn()
    } as unknown as jest.Mocked<DynamoDBDocumentClient>;
    service = new DynamoDBService(mockClient);
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
        ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({});

      const result = await service.createMessageLog(userId, date);

      expect(result).toEqual(expectedLog);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(PutCommand));
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
        ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Item: mockLog
      });

      const result = await service.getMessageLog(messageId);

      expect(result).toEqual(mockLog);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(GetCommand));
    });

    it('should return null when message log not found', async () => {
      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Item: null
      });

      const result = await service.getMessageLog(messageId);

      expect(result).toBeNull();
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
        ttl: Math.floor(new Date('2024-01-02T00:00:00.000Z').getTime() / 1000)
      };

      (mockClient.send as jest.Mock).mockResolvedValueOnce({
        Attributes: expectedLog
      });

      const result = await service.updateMessageStatus(messageId, 'SENT');

      expect(result).toEqual(expectedLog);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(UpdateCommand));
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
  });
}); 
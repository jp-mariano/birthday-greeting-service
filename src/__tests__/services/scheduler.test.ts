import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SchedulerService } from '../../services/scheduler';
import { BirthdayMessage } from '../../types/models';

// Mock the SchedulerClient
jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  CreateScheduleCommand: jest.fn().mockImplementation((params) => ({ ...params })),
  DeleteScheduleCommand: jest.fn().mockImplementation((params) => ({ ...params }))
}));

describe('SchedulerService', () => {
  let service: SchedulerService;
  let mockClient: { send: jest.Mock };
  const mockDate = '2024-01-01T00:00:00.000Z';
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(mockDate));
    console.log = jest.fn();
    console.error = jest.fn();

    mockClient = {
      send: jest.fn()
    };
    service = new SchedulerService(mockClient as unknown as SchedulerClient);
  });

  describe('Constructor', () => {
    beforeEach(() => {
      delete process.env.SCHEDULER_ENDPOINT;
      delete process.env.AWS_REGION;
      delete process.env.IS_OFFLINE;
      delete process.env.STAGE;
      delete process.env.SENDER_FUNCTION_ARN;
      (SchedulerClient as jest.Mock).mockClear();
    });

    it('should initialize with default configuration', () => {
      new SchedulerService();
      
      expect(SchedulerClient).toHaveBeenCalledWith({
        region: 'us-east-1'
      });
    });

    it('should initialize with LocalStack configuration', () => {
      process.env.SCHEDULER_ENDPOINT = 'http://localhost:4566';
      
      new SchedulerService();
      
      expect(SchedulerClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test'
        },
        forcePathStyle: true
      });
    });

    it('should use custom region when provided', () => {
      process.env.AWS_REGION = 'eu-west-1';
      
      new SchedulerService();
      
      expect(SchedulerClient).toHaveBeenCalledWith({
        region: 'eu-west-1'
      });
    });

    it('should use local Lambda ARN in local environment', () => {
      process.env.IS_OFFLINE = 'true';
      const service = new SchedulerService();
      
      expect((service as any).senderFunctionArn).toBe(
        'arn:aws:lambda:us-east-1:000000000000:function:birthday-service-local-birthdayMessageSender'
      );
    });

    it('should use provided Lambda ARN in production', () => {
      const mockArn = 'arn:aws:lambda:us-east-1:123456789012:function:birthday-service-prod-sender';
      process.env.SENDER_FUNCTION_ARN = mockArn;
      const service = new SchedulerService();
      
      expect((service as any).senderFunctionArn).toBe(mockArn);
    });
  });

  describe('scheduleMessage', () => {
    const mockMessage: BirthdayMessage = {
      userId: 'test-user',
      firstName: 'John',
      lastName: 'Doe',
      location: 'America/New_York'
    };
    const mockDate = '2024-01-15';

    it('should create schedule with UTC cron expression in production', async () => {
      // 9am New York time is 14:00 UTC
      const expectedCron = 'cron(0 14 15 1 ? 2024)';
      
      await service.scheduleMessage(mockMessage, mockDate);

      expect(CreateScheduleCommand).toHaveBeenCalledWith({
        Name: 'test-user_2024-01-15',
        ScheduleExpression: expectedCron,
        Target: {
          Arn: expect.any(String),
          RoleArn: expect.any(String),
          Input: JSON.stringify(mockMessage)
        },
        FlexibleTimeWindow: {
          Mode: 'OFF'
        }
      });
      expect(mockClient.send).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Scheduling message for John Doe'));
    });

    it('should create schedule with rate expression in local environment', async () => {
      process.env.IS_OFFLINE = 'true';
      service = new SchedulerService(mockClient as unknown as SchedulerClient);

      await service.scheduleMessage(mockMessage, mockDate);

      expect(CreateScheduleCommand).toHaveBeenCalledWith({
        Name: 'test-user_2024-01-15',
        ScheduleExpression: 'rate(1 minute)',
        Target: {
          Arn: expect.stringContaining('local-birthdayMessageSender'),
          RoleArn: expect.any(String),
          Input: JSON.stringify(mockMessage)
        },
        FlexibleTimeWindow: {
          Mode: 'OFF'
        }
      });
    });

    it('should handle different time zones correctly', async () => {
      // Reset environment variables
      delete process.env.IS_OFFLINE;
      delete process.env.STAGE;
      service = new SchedulerService(mockClient as unknown as SchedulerClient);

      const tokyoMessage: BirthdayMessage = {
        ...mockMessage,
        location: 'Asia/Tokyo'
      };
      // 9am Tokyo time is 00:00 UTC
      const expectedCron = 'cron(0 0 15 1 ? 2024)';

      await service.scheduleMessage(tokyoMessage, mockDate);

      expect(CreateScheduleCommand).toHaveBeenCalledWith(expect.objectContaining({
        ScheduleExpression: expectedCron
      }));
    });

    it('should handle scheduler client errors', async () => {
      const error = new Error('Scheduler error');
      mockClient.send.mockRejectedValueOnce(error);

      await expect(service.scheduleMessage(mockMessage, mockDate))
        .rejects.toThrow('Failed to create schedule');
      expect(console.error).toHaveBeenCalledWith('Failed to create schedule:', error);
    });

    it('should use custom scheduler role when provided', async () => {
      const customRole = 'arn:aws:iam::123456789012:role/custom-scheduler-role';
      process.env.SCHEDULER_ROLE_ARN = customRole;

      await service.scheduleMessage(mockMessage, mockDate);

      expect(CreateScheduleCommand).toHaveBeenCalledWith(expect.objectContaining({
        Target: expect.objectContaining({
          RoleArn: customRole
        })
      }));
    });
  });

  describe('deleteSchedule', () => {
    const userId = 'test-user';
    const date = '2024-01-15';

    it('should delete schedule successfully', async () => {
      await service.deleteSchedule(userId, date);

      expect(DeleteScheduleCommand).toHaveBeenCalledWith({
        Name: `${userId}_${date}`
      });
      expect(mockClient.send).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(`Deleted schedule for user ${userId} on ${date}`);
    });

    it('should handle scheduler client errors', async () => {
      const error = new Error('Scheduler error');
      mockClient.send.mockRejectedValueOnce(error);

      await expect(service.deleteSchedule(userId, date))
        .rejects.toThrow('Failed to delete schedule');
      expect(console.error).toHaveBeenCalledWith('Failed to delete schedule:', error);
    });
  });
}); 
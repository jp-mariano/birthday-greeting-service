import { SchedulerService } from '../../services/scheduler';
import { BirthdayMessage } from '../../types/models';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

// Mock dates for consistent testing
const mockDate = '2024-01-15';
jest.useFakeTimers().setSystemTime(new Date(mockDate));

jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockImplementation(() => Promise.resolve({}))
  })),
  CreateScheduleCommand: jest.fn(),
  DeleteScheduleCommand: jest.fn()
}));

describe('SchedulerService', () => {
  let service: SchedulerService;
  let mockClient: jest.Mocked<Pick<SchedulerClient, 'send'>>;

  const mockMessage: BirthdayMessage = {
    userId: 'test-user-id',
    firstName: 'John',
    lastName: 'Doe',
    location: 'America/New_York'
  };

  beforeEach(() => {
    mockClient = {
      send: jest.fn().mockImplementation(() => Promise.resolve({}))
    };

    service = new SchedulerService(mockClient as unknown as SchedulerClient);
  });

  describe('scheduleMessage', () => {
    it('should schedule message successfully', async () => {
      await service.scheduleMessage(mockMessage, mockDate);

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(CreateScheduleCommand));
    });

    it('should handle schedule creation error', async () => {
      const error = new Error('Failed to create schedule');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.scheduleMessage(mockMessage, mockDate))
        .rejects.toThrow('Failed to create schedule');
    });

    it('should use default client instance when not provided', async () => {
      const defaultService = new SchedulerService();
      await defaultService.scheduleMessage(mockMessage, mockDate);

      expect(SchedulerClient).toHaveBeenCalled();
    });
  });

  describe('deleteSchedule', () => {
    it('should delete schedule successfully', async () => {
      await service.deleteSchedule(mockMessage.userId, mockDate);

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(DeleteScheduleCommand));
    });

    it('should handle schedule deletion error', async () => {
      const error = new Error('Failed to delete schedule');
      mockClient.send.mockImplementationOnce(() => Promise.reject(error));

      await expect(service.deleteSchedule(mockMessage.userId, mockDate))
        .rejects.toThrow('Failed to delete schedule');
    });
  });
}); 
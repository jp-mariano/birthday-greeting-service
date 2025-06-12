import { jest } from '@jest/globals';
import { QueryResult } from 'pg';
import { DatabaseService } from '../../services/database';

// Mock environment variables
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.STAGE = 'dev';

// Define mock types
interface MockQueryResult extends QueryResult {
  command: string;
  oid: number;
  fields: never[];
}

// Mock pg Pool with type assertion
const mockPool = {
  query: jest.fn() as jest.MockedFunction<(text: string, values?: any[]) => Promise<MockQueryResult>>,
  end: jest.fn() as jest.MockedFunction<() => Promise<void>>
};

// Helper function to create mock query results
function createMockQueryResult(data: Partial<MockQueryResult> = {}): MockQueryResult {
  return {
    rows: [],
    rowCount: 0,
    command: '',
    oid: 0,
    fields: [],
    ...data
  } as MockQueryResult;
}

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool)
}));

describe('DatabaseService', () => {
  let service: DatabaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = DatabaseService.getInstance();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = DatabaseService.getInstance();
      const instance2 = DatabaseService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after cleanup', async () => {
      const instance1 = DatabaseService.getInstance();
      await instance1.cleanup();
      const instance2 = DatabaseService.getInstance();
      expect(instance1).not.toBe(instance2);
    });

    it('should handle production environment', () => {
      // Save original env
      const originalStage = process.env.STAGE;
      const originalPort = process.env.DB_PORT;

      // Set production env
      process.env.STAGE = 'prod';
      process.env.DB_PORT = undefined;

      // Get new instance
      const instance = DatabaseService.getInstance();
      expect(instance).toBeTruthy();

      // Restore env
      process.env.STAGE = originalStage;
      process.env.DB_PORT = originalPort;
    });
  });

  describe('createUser', () => {
    it('should create a user successfully', async () => {
      const newUser = {
        firstName: 'John',
        lastName: 'Doe',
        birthday: new Date('1990-01-01'),
        location: 'Asia/Singapore'
      };

      const mockDbResponse = {
        rows: [{
          id: '123',
          first_name: newUser.firstName,
          last_name: newUser.lastName,
          birthday: newUser.birthday,
          location: newUser.location,
          created_at: new Date(),
          updated_at: new Date(),
          last_greeting_sent_at: null
        }],
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: []
      };

      mockPool.query.mockResolvedValueOnce(mockDbResponse);

      const result = await service.createUser(newUser);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        [newUser.firstName, newUser.lastName, newUser.birthday, newUser.location]
      );

      expect(result).toEqual({
        id: '123',
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        birthday: newUser.birthday,
        location: newUser.location,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        lastGreetingSentAt: null
      });
    });

    it('should handle database errors', async () => {
      const newUser = {
        firstName: 'John',
        lastName: 'Doe',
        birthday: new Date('1990-01-01'),
        location: 'Asia/Singapore'
      };

      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.createUser(newUser)).rejects.toThrow('Database error');
    });
  });

  describe('updateUser', () => {
    it('should update a user successfully', async () => {
      const userId = '123';
      const updates = {
        firstName: 'Jane',
        lastName: 'Smith'
      };

      const mockDbResponse = {
        rows: [{
          id: userId,
          first_name: updates.firstName,
          last_name: updates.lastName,
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          created_at: new Date(),
          updated_at: new Date(),
          last_greeting_sent_at: null
        }],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: []
      };

      mockPool.query.mockResolvedValueOnce(mockDbResponse);

      const result = await service.updateUser(userId, updates);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [userId, updates.firstName, updates.lastName]
      );

      expect(result).toEqual({
        id: userId,
        firstName: updates.firstName,
        lastName: updates.lastName,
        birthday: expect.any(Date),
        location: 'Asia/Singapore',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        lastGreetingSentAt: null
      });
    });

    it('should handle partial updates', async () => {
      const userId = '123';
      const updates = {
        firstName: 'Jane'
      };

      const mockDbResponse = {
        rows: [{
          id: userId,
          first_name: updates.firstName,
          last_name: 'Doe',
          birthday: new Date('1990-01-01'),
          location: 'Asia/Singapore',
          created_at: new Date(),
          updated_at: new Date(),
          last_greeting_sent_at: null
        }],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: []
      };

      mockPool.query.mockResolvedValueOnce(mockDbResponse);

      const result = await service.updateUser(userId, updates);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [userId, updates.firstName]
      );

      expect(result.firstName).toBe(updates.firstName);
      expect(result.lastName).toBe('Doe');
    });

    it('should throw error when user not found', async () => {
      const userId = 'non-existent';
      const updates = { firstName: 'Jane' };

      mockPool.query.mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] });

      await expect(service.updateUser(userId, updates))
        .rejects
        .toThrow('User not found');
    });

    it('should handle database errors', async () => {
      const userId = '123';
      const updates = { firstName: 'Jane' };

      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.updateUser(userId, updates)).rejects.toThrow('Database error');
    });
  });

  describe('deleteUser', () => {
    it('should delete a user successfully', async () => {
      const userId = '123';
      mockPool.query.mockResolvedValueOnce(createMockQueryResult({ rowCount: 1 }));

      await service.deleteUser(userId);

      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM users WHERE id = $1',
        [userId]
      );
    });

    it('should throw error when user not found', async () => {
      const userId = 'non-existent';
      mockPool.query.mockResolvedValueOnce(createMockQueryResult({ rowCount: 0 }));

      await expect(service.deleteUser(userId))
        .rejects
        .toThrow('User not found');
    });

    it('should handle database errors', async () => {
      const userId = '123';
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.deleteUser(userId)).rejects.toThrow('Database error');
    });
  });

  describe('getUsersWithBirthdayNow', () => {
    it('should find users with birthday at 9 AM their time', async () => {
      const mockUsers = [{
        id: '123',
        first_name: 'Birthday',
        last_name: 'User',
        birthday: new Date('1990-06-12'),
        location: 'Asia/Singapore',
        created_at: new Date(),
        updated_at: new Date(),
        last_greeting_sent_at: null
      }];

      const mockDbResponse = {
        rows: mockUsers,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      };

      // Reset mock before use
      mockPool.query.mockReset();
      mockPool.query.mockImplementation((query, params) => {
        return Promise.resolve(mockDbResponse);
      });

      const result = await service.getUsersWithBirthdayNow();

      // Get the actual query
      const actualQuery = mockPool.query.mock.calls[0][0];

      // Verify the essential parts of the query
      expect(actualQuery).toMatch(/SELECT \*\s+FROM users\s+WHERE/i);
      expect(actualQuery).toMatch(/EXTRACT\(HOUR FROM NOW\(\) AT TIME ZONE location\) = 9/i);
      expect(actualQuery).toMatch(/EXTRACT\(MONTH FROM birthday\)/i);
      expect(actualQuery).toMatch(/EXTRACT\(DAY FROM birthday\)/i);
      expect(actualQuery).toMatch(/last_greeting_sent_at/i);
      expect(actualQuery).toMatch(/FOR UPDATE SKIP LOCKED/i);

      // Verify the mock was called correctly
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query.mock.calls[0]).toHaveLength(1); // Should only have the query string, no params

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '123',
        firstName: 'Birthday',
        lastName: 'User',
        birthday: expect.any(Date),
        location: 'Asia/Singapore',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        lastGreetingSentAt: null
      });
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.getUsersWithBirthdayNow()).rejects.toThrow('Database error');
    });

    it('should return empty array when no birthdays found', async () => {
      mockPool.query.mockResolvedValueOnce(createMockQueryResult({ rows: [] }));

      const result = await service.getUsersWithBirthdayNow();
      expect(result).toEqual([]);
    });
  });

  describe('updateLastGreetingSent', () => {
    it('should update last greeting sent timestamp', async () => {
      const userId = '123';
      mockPool.query.mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] });

      await service.updateLastGreetingSent(userId);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        [userId]
      );
    });

    it('should throw error if greeting already sent this year', async () => {
      const userId = '123';
      mockPool.query.mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] });

      await expect(service.updateLastGreetingSent(userId))
        .rejects
        .toThrow('User not found or greeting already sent this year');
    });

    it('should handle database errors', async () => {
      const userId = '123';
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.updateLastGreetingSent(userId)).rejects.toThrow('Database error');
    });
  });

  describe('cleanup', () => {
    it('should end pool and reset instance', async () => {
      await service.cleanup();
      expect(mockPool.end).toHaveBeenCalled();
      expect(DatabaseService.getInstance()).not.toBe(service);
    });

    it('should not end pool if already ending', async () => {
      await service.cleanup();
      mockPool.end.mockClear();
      await service.cleanup();
      expect(mockPool.end).not.toHaveBeenCalled();
    });
  });

  // Test utility functions through public methods
  describe('utility functions', () => {
    it('should convert camelCase to snake_case in update queries', async () => {
      const userId = '123';
      const updates = {
        firstName: 'Jane',
        lastName: 'Smith'
      };

      mockPool.query.mockResolvedValueOnce(createMockQueryResult({
        rows: [{
          id: userId,
          first_name: updates.firstName,
          last_name: updates.lastName,
          birthday: new Date(),
          location: 'Asia/Singapore',
          created_at: new Date(),
          updated_at: new Date(),
          last_greeting_sent_at: null
        }]
      }));

      await service.updateUser(userId, updates);

      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('first_name');
      expect(query).toContain('last_name');
    });
  });
}); 
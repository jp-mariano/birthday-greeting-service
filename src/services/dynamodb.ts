import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import { User, MessageLog } from '../types/models';

export class DynamoDBService {
  private client: DynamoDBDocumentClient;
  private usersTable: string;
  private logsTable: string;

  constructor(client?: DynamoDBDocumentClient) {
    this.client = client || DynamoDBDocumentClient.from({} as any);
    this.usersTable = process.env.USERS_TABLE || 'test-users-table';
    this.logsTable = process.env.MESSAGE_LOGS_TABLE || 'test-logs-table';
  }

  private validateLocation(location: string): void {
    try {
      const zone = DateTime.now().setZone(location);
      if (!zone.isValid) {
        throw new Error(`Invalid location: ${location}`);
      }
    } catch (error) {
      throw new Error(`Invalid location: ${location}`);
    }
  }

  private validateBirthday(birthday: string): void {
    const date = DateTime.fromISO(birthday);
    if (!date.isValid) {
      throw new Error(`Invalid birthday: ${birthday}. Must be in YYYY-MM-DD format.`);
    }
  }

  private validateDate(date: string): void {
    const parsedDate = DateTime.fromISO(date);
    if (!parsedDate.isValid) {
      throw new Error(`Invalid date: ${date}. Must be in YYYY-MM-DD format.`);
    }
  }

  async createUser(userData: Omit<User, 'userId' | 'sk' | 'birthdayMD' | 'createdAt' | 'updatedAt'>): Promise<User> {
    // Validate location and birthday
    this.validateLocation(userData.location);
    this.validateBirthday(userData.birthday);

    const now = DateTime.utc().toISO();
    const userId = randomUUID();
    const birthdayMD = DateTime.fromISO(userData.birthday).toFormat('MM-dd');

    const user: User = {
      ...userData,
      userId,
      sk: 'USER#metadata',
      birthdayMD,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.client.send(new PutCommand({
        TableName: this.usersTable,
        Item: user,
        ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(sk)'
      }));

      return user;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message === 'ConditionalCheckFailedException')) {
        throw new Error(`User with ID ${userId} already exists`);
      }
      throw error;
    }
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    // Validate location and birthday if provided
    if (updates.location) {
      this.validateLocation(updates.location);
    }
    if (updates.birthday) {
      this.validateBirthday(updates.birthday);
      updates.birthdayMD = DateTime.fromISO(updates.birthday).toFormat('MM-dd');
    }

    const now = DateTime.utc().toISO();

    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': now
    };

    if (updates.firstName) {
      updateExpressions.push('#firstName = :firstName');
      expressionAttributeNames['#firstName'] = 'firstName';
      expressionAttributeValues[':firstName'] = updates.firstName;
    }

    if (updates.lastName) {
      updateExpressions.push('#lastName = :lastName');
      expressionAttributeNames['#lastName'] = 'lastName';
      expressionAttributeValues[':lastName'] = updates.lastName;
    }

    if (updates.birthday) {
      updateExpressions.push('#birthday = :birthday');
      updateExpressions.push('#birthdayMD = :birthdayMD');
      expressionAttributeNames['#birthday'] = 'birthday';
      expressionAttributeNames['#birthdayMD'] = 'birthdayMD';
      expressionAttributeValues[':birthday'] = updates.birthday;
      expressionAttributeValues[':birthdayMD'] = updates.birthdayMD;
    }

    if (updates.location) {
      updateExpressions.push('#location = :location');
      expressionAttributeNames['#location'] = 'location';
      expressionAttributeValues[':location'] = updates.location;
    }

    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.usersTable,
        Key: { userId, sk: 'USER#metadata' },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(userId) AND attribute_exists(sk)'
      }));

      if (!result?.Attributes) {
        throw new Error(`User ${userId} not found`);
      }

      return result.Attributes as User;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new Error(`User ${userId} not found`);
      }
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.usersTable,
        Key: { userId, sk: 'USER#metadata' },
        ConditionExpression: 'attribute_exists(userId) AND attribute_exists(sk)'
      }));
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new Error(`User ${userId} not found`);
      }
      throw error;
    }
  }

  async getTodaysBirthdays(): Promise<User[]> {
    const today = DateTime.utc().toFormat('MM-dd');

    const result = await this.client.send(new QueryCommand({
      TableName: this.usersTable,
      IndexName: 'birthdayIndex',
      KeyConditionExpression: 'birthdayMD = :today',
      ExpressionAttributeValues: {
        ':today': today
      }
    }));

    return result?.Items as User[] || [];
  }

  async getMessageLog(messageId: string): Promise<MessageLog | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.logsTable,
      Key: { messageId }
    }));

    return result?.Item as MessageLog || null;
  }

  async createMessageLog(userId: string, date: string): Promise<MessageLog> {
    // Validate date format
    this.validateDate(date);

    const now = DateTime.utc().toISO();
    const messageId = `${userId}_${date}`;
    const ttl = Math.floor(DateTime.fromISO(date).plus({ days: 1 }).setZone('UTC', { keepLocalTime: true }).toSeconds());

    const messageLog: MessageLog = {
      messageId,
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      ttl
    };

    try {
      await this.client.send(new PutCommand({
        TableName: this.logsTable,
        Item: messageLog,
        ConditionExpression: 'attribute_not_exists(messageId)'
      }));

      return messageLog;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message === 'ConditionalCheckFailedException')) {
        throw new Error(`Message log already exists for user ${userId} on ${date}`);
      }
      throw error;
    }
  }

  async updateMessageStatus(messageId: string, status: 'PENDING' | 'SENT' | 'FAILED'): Promise<MessageLog> {
    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.logsTable,
        Key: { messageId },
        UpdateExpression: 'SET #status = :status, #attempts = #attempts + :increment, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#attempts': 'attempts',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':increment': 1,
          ':now': DateTime.utc().toISO()
        },
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(messageId)'
      }));

      if (!result?.Attributes) {
        throw new Error(`Message ${messageId} not found`);
      }

      return result.Attributes as MessageLog;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException' || 
          (error instanceof Error && error.message === 'ConditionalCheckFailedException')) {
        throw new Error(`Message ${messageId} not found`);
      }
      throw error;
    }
  }
} 
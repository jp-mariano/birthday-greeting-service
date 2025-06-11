import { Pool, PoolConfig } from 'pg';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  birthday: Date;
  location: string;
  createdAt: Date;
  updatedAt: Date;
  lastGreetingSentAt?: Date;
}

export class DatabaseService {
  private pool: Pool;
  private static instance: DatabaseService;

  private constructor() {
    const config: PoolConfig = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.STAGE === 'dev' ? false : { rejectUnauthorized: false },
      // Lambda-optimized pool config
      max: 1,
      idleTimeoutMillis: 120000,
    };

    this.pool = new Pool(config);
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'lastGreetingSentAt'>): Promise<User> {
    const query = `
      INSERT INTO users (first_name, last_name, birthday, location)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      user.firstName,
      user.lastName,
      user.birthday,
      user.location
    ]);

    return this.mapRowToUser(result.rows[0]);
  }

  async updateUser(id: string, user: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'lastGreetingSentAt'>>): Promise<User> {
    const setClause = Object.entries(user)
      .map(([key, _], index) => `${this.toSnakeCase(key)} = $${index + 2}`)
      .join(', ');

    const query = `
      UPDATE users
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;

    const values = [id, ...Object.values(user)];
    const result = await this.pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return this.mapRowToUser(result.rows[0]);
  }

  async deleteUser(id: string): Promise<void> {
    const query = 'DELETE FROM users WHERE id = $1';
    const result = await this.pool.query(query, [id]);

    if (result.rowCount === 0) {
      throw new Error('User not found');
    }
  }

  async getUsersWithBirthdayNow(): Promise<User[]> {
    const query = `
      SELECT *
      FROM users
      WHERE 
        -- Check if it's 9:00 AM in their location
        EXTRACT(HOUR FROM NOW() AT TIME ZONE location) = 9
        AND EXTRACT(MINUTE FROM NOW() AT TIME ZONE location) BETWEEN 0 AND 14
        -- Check if it's their birthday in their location
        AND EXTRACT(MONTH FROM birthday) = EXTRACT(MONTH FROM NOW() AT TIME ZONE location)
        AND EXTRACT(DAY FROM birthday) = EXTRACT(DAY FROM NOW() AT TIME ZONE location)
        -- Ensure we haven't sent a greeting today in their location
        AND (
          last_greeting_sent_at IS NULL 
          OR last_greeting_sent_at < (NOW() AT TIME ZONE location)::date
        )
    `;

    const result = await this.pool.query(query);
    return result.rows.map(this.mapRowToUser);
  }

  async markGreetingSent(userId: string): Promise<void> {
    const query = `
      UPDATE users
      SET last_greeting_sent_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [userId]);
  }

  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      birthday: row.birthday,
      location: row.location,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastGreetingSentAt: row.last_greeting_sent_at
    };
  }

  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  async cleanup(): Promise<void> {
    await this.pool.end();
  }
} 
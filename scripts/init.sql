-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birthday DATE NOT NULL,
    location TEXT NOT NULL,  -- IANA timezone (e.g., 'Asia/Singapore')
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_greeting_sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Index for birthday checking query
    CONSTRAINT valid_location CHECK (location IN (SELECT name FROM pg_timezone_names))
);

-- Index for efficient birthday queries
CREATE INDEX IF NOT EXISTS idx_users_birthday_location ON users (
    (EXTRACT(MONTH FROM birthday)),
    (EXTRACT(DAY FROM birthday)),
    location
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 
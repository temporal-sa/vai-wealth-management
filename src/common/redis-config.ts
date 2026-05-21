import Redis from 'ioredis';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 6379;

export interface RedisConfig {
  host: string;
  port: number;
}

export function loadRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST ?? DEFAULT_HOST,
    port: Number(process.env.REDIS_PORT ?? DEFAULT_PORT),
  };
}

export function createRedisClient(config: RedisConfig = loadRedisConfig()): Redis {
  return new Redis({ host: config.host, port: config.port });
}
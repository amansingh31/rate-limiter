import Redis from 'ioredis';
import { getTracker } from './utils';

export class RateLimiterService {
    private redisClient: Redis;
    private projectName: string;
    private windowSizeInSeconds: number;
    private logger: any;
    private projectConfig: ProjectDataConfig

    constructor(config: RateLimiterConfig) {
        if (!config.projectName || !config.host || !config.port || !config.windowSizeInSeconds) {
            throw Error('Invalid configuration!');
        }
        this.projectName = config.projectName;
        this.logger = config.logger;
        this.redisClient = new Redis()
        this.getInitialProjectData(config.projectName).then((res) => {
            this.projectConfig = res;
        }).catch(err => {
            throw Error('Something went wrong!!!')
        });
    }

    async getInitialProjectData(projectName): Promise<ProjectDataConfig> {
        const projectData = await this.redisClient.get(projectName);
        if (projectData) {
            return JSON.parse(projectData);
        }
        const initData = {
            blockDurationInSeconds: 300,
            blockStrategy: 'temporary',
            blockedIps: [
                {
                    ip: '198.51.100.1',
                    blockStartTime: '2023-12-20T12:00:00Z',
                    blockDurationInSeconds: 600,
                },
                {
                    ip: '198.51.100.2',
                    blockStartTime: '2023-12-20T13:00:00Z',
                    blockDurationInSeconds: 1200,
                },
            ],
            customLimits: [
                {
                    ip: '203.0.113.1',
                    limit: 200,
                },
                {
                    ip: '203.0.113.2',
                    limit: 50,
                },
            ],
            enableLogging: true,
            enableRateLimit: true,
            excludeIps: ['192.168.1.1', '192.168.1.2'],
            generalLimit: 100,
            logLevel: 'warning',
            windowSizeInSeconds: 60,
        }
        await this.redisClient.set(projectName, JSON.stringify(initData));
        return initData;
    }

    async rateLimit(req) {
        try {
            //     Check Rate limiter is active or not
            if (!this.projectConfig.enableRateLimit) {
                this.logger.info(`Rate limiter is disabled for ${this.projectName}`);
                return true;
            }
            const tracker = getTracker(req);
            if (this.projectConfig.excludeIps.includes(tracker)) {
                this.logger.info(`Rate limiter skipped for ip ${tracker}`);
                return true;
            }

            const limit = await this.getLimit(tracker);

            if (!limit) {
                this.logger.error(`Not able to get the req limit for ${this.projectName}`);
                return true;
            }

            const windowSizeInSeconds = this.windowSizeInSeconds;
            const currentTime = Math.floor(Date.now() / 1000);
            const key = `rate:${this.projectName}:${tracker}`;
            const currentWindowStart =
                currentTime - (currentTime % windowSizeInSeconds);
            const previousWindowStart = currentWindowStart - windowSizeInSeconds;
            // Remove timestamps outside the previous window
            await this.redisClient.zremrangebyscore(key, 0, previousWindowStart);

            // Count requests in the previous and current window

            const [previousCount, currentCount] = await Promise.all([
                await this.redisClient.zcount(key, previousWindowStart, currentWindowStart),
                await this.redisClient.zcount(key, currentWindowStart, currentTime),
            ]);
            // Calculate weighted rate
            const elapsedTimeInCurrentWindow = currentTime - currentWindowStart;
            const weightedRate =
                previousCount *
                ((windowSizeInSeconds - elapsedTimeInCurrentWindow) /
                    windowSizeInSeconds) +
                currentCount;
            if (weightedRate >= limit) {
                const retryAfter = windowSizeInSeconds - elapsedTimeInCurrentWindow;
                this.logger.warn(`The rate limit exceeds for ip ${tracker}, End point ${req.path} and Method: ${req.method}`)
                return false;
            }

            // Add the current timestamp to the sorted set and set expiration
            await this.redisClient
                .multi()
                .zadd(key, currentTime, currentTime)
                .expire(key, windowSizeInSeconds) // Expire after 2 minutes
                .exec();
            return true;
        } catch (e) {

        }
    }

    async getLimit(tracker) {
        if (this.projectConfig.customLimits?.length) {
            return this.projectConfig.customLimits.find((limit) => limit.ip === tracker)?.limit || this.projectConfig.generalLimit;
        }
        return this.projectConfig.generalLimit;
    }

}


export interface RateLimiterConfig {
    windowSizeInSeconds?: number;
    defaultLimit?: number;
    host: string;
    port: number;
    projectName: string;
    logger: any;
}

export interface ProjectDataConfig {
    generalLimit: number;
    windowSizeInSeconds: number;
    excludeIps: string[];
    customLimits: CustomLimit[];
    enableLogging: boolean;
    logLevel: string;
    blockStrategy: string;
    blockDurationInSeconds: number;
    enableRateLimit: boolean;
    blockedIps: BlockIps[]
}

interface CustomLimit {
    ip: string;
    limit: number;
}

interface BlockIps{
    ip: string,
    blockStartTime: string,
    blockDurationInSeconds: number
}

import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

/**
 * Enhanced logger with request ID support
 * Logs can include requestId for distributed tracing
 */
export function logWithId(level: string, message: string, requestId?: string, meta?: any) {
  const logMeta = { requestId, ...meta }
  logger.log(level, message, logMeta)
}

export default logger;

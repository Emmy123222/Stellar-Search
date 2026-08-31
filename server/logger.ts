import winston from 'winston';

// Configure Winston to log structured JSON to stderr.
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      // By default, Winston writes to stdout. We redirect to stderr for all log levels.
      stderrLevels: ['error', 'warn', 'info', 'debug'],
      consoleWarnLevels: [],
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.json()
      ),
    }),
  ],
});

export default logger;

import dotenv from 'dotenv'
import { formatConfigurationError, readServerConfig } from '../src/lib/config'

dotenv.config()
try {
  readServerConfig()
  console.log('Configuration is valid.')
} catch (error) {
  console.error(formatConfigurationError(error))
  process.exitCode = 1
}

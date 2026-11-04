import { APICallError, wrapProvider } from 'ai';
import { ApplicationFailure } from '@temporalio/common';
import type { AiSdkPluginOptions } from '@temporalio/ai-sdk';
import { ChaosFlag } from '../common/chaos-manager';
import { injectFailure } from './chaos';

type ProviderV3 = AiSdkPluginOptions['modelProvider'];

// How long to wait before retrying a throttled call, like a Retry-After header
export const RATE_LIMIT_RETRY_AFTER = '15s';

export function rateLimited(message: string, cause?: Error): ApplicationFailure {
  return ApplicationFailure.create({
    message,
    type: 'ModelRateLimited',
    nextRetryDelay: RATE_LIMIT_RETRY_AFTER,
    cause,
  });
}

/** A real HTTP 429 from the provider becomes a retryable failure that waits RATE_LIMIT_RETRY_AFTER. */
export function translateModelError(error: unknown): unknown {
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return rateLimited(`Gemini API throttled the request: ${error.message}`, error);
  }
  return error;
}

/**
 * Wraps the provider that the AiSdkPlugin calls inside its model activity, so the chaos
 * panel's LLM flags fail model calls the way a real outage or rate limit would.
 */
export function chaosAwareProvider(provider: ProviderV3): ProviderV3 {
  return wrapProvider({
    provider,
    languageModelMiddleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        await injectFailure(ChaosFlag.LLM_DOWN, new Error('ConnectionError: Gemini API unavailable'));
        await injectFailure(ChaosFlag.LLM_RATE_LIMITED, rateLimited('Gemini API rate limit exceeded (HTTP 429)'));
        try {
          return await doGenerate();
        } catch (error) {
          throw translateModelError(error);
        }
      },
    },
  });
}

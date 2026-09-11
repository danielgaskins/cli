import { isEndpointFeedbackDisabledLocally } from './feedback-settings';

export function filterFeedbackMetadata(metadata: any): any {
  if (
    !isEndpointFeedbackDisabledLocally() ||
    !metadata ||
    typeof metadata !== 'object'
  )
    return metadata;
  const { feedback: _feedback, ...rest } = metadata;
  return rest;
}

export function reportFeedbackInvitation(
  metadata: any,
  endpoint: string
): void {
  if (isEndpointFeedbackDisabledLocally()) return;
  metadata = filterFeedbackMetadata(metadata);
  if (typeof metadata?.jobId === 'string') {
    process.stderr.write(`Feedback job (${endpoint}): ${metadata.jobId}\n`);
  }
  if (typeof metadata?.feedback?.message === 'string') {
    process.stderr.write(
      `${metadata.feedback.message}\nUse: firecrawl feedback ${endpoint} ${metadata.feedback.jobId} --rating <good|partial|bad> --task <task> --assessment <assessment> --observations-file <path>\n`
    );
  }
}

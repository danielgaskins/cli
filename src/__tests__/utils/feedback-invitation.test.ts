import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportFeedbackInvitation } from '../../utils/feedback-invitation';

describe('feedback invitation output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FIRECRAWL_NO_ENDPOINT_FEEDBACK;
  });
  it('keeps content stdout unchanged and writes optional guidance to stderr', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    reportFeedbackInvitation(
      {
        jobId: 'job-1',
        feedback: { jobId: 'job-1', message: 'Optional feedback.' },
      },
      'parse'
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join('')).toContain(
      'firecrawl feedback parse job-1'
    );
  });
  it('suppresses invitations when feedback is disabled locally', () => {
    process.env.FIRECRAWL_NO_ENDPOINT_FEEDBACK = 'true';
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    reportFeedbackInvitation(
      {
        jobId: 'job-1',
        feedback: { jobId: 'job-1', message: 'Optional feedback.' },
      },
      'search'
    );
    expect(stderr).not.toHaveBeenCalled();
  });
  it('does not invent invitations when metadata is absent', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    reportFeedbackInvitation(undefined, 'scrape');
    expect(stderr).not.toHaveBeenCalled();
  });
});

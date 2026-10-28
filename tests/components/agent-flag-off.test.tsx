// @vitest-environment happy-dom
// With FEATURES.agent off, nothing points at the connector.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';

vi.mock('../../src/config', () => ({ FEATURES: { agent: false, agentOnStandard: true }, REPO_URL: 'https://github.com/derintolu/learn-wp-reimagined' }));

import { RecordPanel } from '../../src/components/RecordPanel';
import { CapNotice } from '../../src/components/CapNotice';

describe('agent feature off', () => {
  it('CapNotice hides "Continue in your own AI" but keeps the message', () => {
    const { container } = render(<CapNotice status={{ ai: 'capped', reason: 'day-cap' }} />);
    expect(screen.queryByRole('link', { name: 'Continue in your own AI' })).toBeNull();
    expect((container.textContent ?? '').length).toBeGreaterThan(20);
  });

  it('with agent off, no agent or disconnect entries show even if agentOnStandard is set', () => {
    render(<RecordPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Your record/ }));
    expect(screen.queryByRole('button', { name: 'Disconnect agents' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue in your AI' })).toBeNull();
  });
});

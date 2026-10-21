import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen, fireEvent } from '../../../tests/helpers/render';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { useSystemNoticeStore } from '../../store/systemNoticeStore';
import { ModalRenderer } from './SystemNoticeModal';
import type { SystemNoticeDTO } from '../../store/systemNoticeStore';

// Stub react-markdown to avoid async chunk issues in tests
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <span data-testid="md">{children}</span>,
}));
vi.mock('remark-gfm', () => ({ default: () => ({}) }));
vi.mock('rehype-sanitize', () => ({ default: () => ({}) }));

function makeNotice(overrides: Partial<SystemNoticeDTO> = {}): SystemNoticeDTO {
  return {
    id: 'test-notice-1',
    display: 'modal',
    severity: 'info',
    titleKey: 'Test Title',
    bodyKey: 'Test body text',
    dismissible: true,
    ...overrides,
  };
}

/**
 * Advance fake timers past the grace delay (2× rAF fallback → each is a
 * setTimeout(0), then 500ms).  All three timers fire in sequence with
 * runAllTimers() — no need to advance exact milliseconds.
 */
async function flushGraceDelay() {
  await act(async () => {
    vi.runAllTimers();
  });
}

describe('ModalRenderer', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/system-notices/:id/dismiss', () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );
    useSystemNoticeStore.setState({ notices: [], loaded: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  it('FE-SN-MODAL-001: renders title and body after grace delay', async () => {
    const notice = makeNotice();
    render(<ModalRenderer notices={[notice]} />);

    // Before delay fires: dialog present but body not yet visible (class-based)
    expect(screen.getByRole('dialog')).toBeTruthy();

    await flushGraceDelay();

    expect(screen.getByText('Test Title')).toBeTruthy();
    expect(screen.getByText('Test body text')).toBeTruthy();
  });

  it('FE-SN-MODAL-002: dismiss button calls store.dismiss(id)', async () => {
    const notice = makeNotice();
    useSystemNoticeStore.setState({ notices: [notice], loaded: true });

    const dismissSpy = vi.spyOn(useSystemNoticeStore.getState(), 'dismiss');
    render(<ModalRenderer notices={[notice]} />);

    await flushGraceDelay();

    const dismissBtn = screen.getByLabelText('Dismiss');
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(dismissSpy).toHaveBeenCalledWith('test-notice-1');
  });

  it('FE-SN-MODAL-003: non-dismissible critical notice hides dismiss affordance', async () => {
    const notice = makeNotice({ severity: 'critical', dismissible: false });
    render(<ModalRenderer notices={[notice]} />);

    await flushGraceDelay();

    expect(screen.queryByLabelText('Dismiss')).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
  });

  it('FE-SN-MODAL-004: ESC key does not close non-dismissible notice', async () => {
    const notice = makeNotice({ severity: 'critical', dismissible: false });
    useSystemNoticeStore.setState({ notices: [notice], loaded: true });

    const dismissSpy = vi.spyOn(useSystemNoticeStore.getState(), 'dismiss');
    render(<ModalRenderer notices={[notice]} />);

    await flushGraceDelay();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(dismissSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('FE-SN-MODAL-005: CTA nav button dismisses all notices (not just current)', async () => {
    // CTA is only shown on the last page; navigate there first
    const noticeA = makeNotice({ id: 'n-a', titleKey: 'Notice A' });
    const noticeB = makeNotice({ id: 'n-b', titleKey: 'Notice B', cta: { kind: 'nav', labelKey: 'Go to trips', href: '/trips' } });
    useSystemNoticeStore.setState({ notices: [noticeA, noticeB], loaded: true });

    const dismissSpy = vi.spyOn(useSystemNoticeStore.getState(), 'dismiss');
    render(<ModalRenderer notices={[noticeA, noticeB]} />);

    await flushGraceDelay();

    // Navigate to last page
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Go to notice 2'));
    });
    await flushGraceDelay();

    const ctaBtn = screen.getByRole('button', { name: 'Go to trips' });
    await act(async () => {
      fireEvent.click(ctaBtn);
    });

    expect(dismissSpy).toHaveBeenCalledWith('n-a');
    expect(dismissSpy).toHaveBeenCalledWith('n-b');
    expect(dismissSpy).toHaveBeenCalledTimes(2);
  });

  it('FE-SN-MODAL-006: modal backdrop has opacity-0 class before grace delay fires', () => {
    const notice = makeNotice();
    const { container } = render(<ModalRenderer notices={[notice]} />);

    // Dialog is in DOM, backdrop has opacity-0 before timers fire
    expect(screen.getByRole('dialog')).toBeTruthy();
    const backdrop = container.querySelector('[role="presentation"]');
    expect(backdrop?.className).toContain('opacity-0');
  });

  it('FE-SN-MODAL-007: body params are interpolated before rendering', async () => {
    const notice = makeNotice({
      bodyKey: 'Hello {name}, welcome to {app}',
      bodyParams: { name: 'Alice', app: 'TREK' },
    });
    render(<ModalRenderer notices={[notice]} />);

    await flushGraceDelay();

    expect(screen.getByText('Hello Alice, welcome to TREK')).toBeTruthy();
  });

  it('FE-SN-MODAL-008: empty notices renders nothing', () => {
    const { container } = render(<ModalRenderer notices={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Multipage (pager) ──────────────────────────────────────────────────────

  it('FE-SN-MODAL-009: pager is hidden when only one notice is present', async () => {
    const notice = makeNotice();
    render(<ModalRenderer notices={[notice]} />);
    await flushGraceDelay();

    expect(screen.queryByLabelText('Previous notice')).toBeNull();
    expect(screen.queryByLabelText('Next notice')).toBeNull();
  });

  it('FE-SN-MODAL-010: pager shows counter and dots for multiple notices', async () => {
    const notices = [
      makeNotice({ id: 'n1', titleKey: 'Notice A' }),
      makeNotice({ id: 'n2', titleKey: 'Notice B' }),
      makeNotice({ id: 'n3', titleKey: 'Notice C' }),
    ];
    render(<ModalRenderer notices={notices} />);
    await flushGraceDelay();

    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByLabelText('Go to notice 1')).toBeTruthy();
    expect(screen.getByLabelText('Go to notice 2')).toBeTruthy();
    expect(screen.getByLabelText('Go to notice 3')).toBeTruthy();
    expect(screen.getByLabelText('Previous notice')).toBeTruthy();
    expect(screen.getByLabelText('Next notice')).toBeTruthy();
  });

  it('FE-SN-MODAL-011: next button advances to the next notice; prev returns', async () => {
    const notices = [
      makeNotice({ id: 'n1', titleKey: 'Notice A' }),
      makeNotice({ id: 'n2', titleKey: 'Notice B' }),
      makeNotice({ id: 'n3', titleKey: 'Notice C' }),
    ];
    render(<ModalRenderer notices={notices} />);
    await flushGraceDelay();

    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Notice A')).toBeTruthy();

    // Navigate to page 2
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Next notice'));
    });
    await flushGraceDelay();

    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('Notice B')).toBeTruthy();

    // Navigate back to page 1
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Previous notice'));
    });
    await flushGraceDelay();

    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Notice A')).toBeTruthy();
  });

  it('FE-SN-MODAL-012: ArrowRight / ArrowLeft keys navigate between pages', async () => {
    const notices = [
      makeNotice({ id: 'n1', titleKey: 'Notice A' }),
      makeNotice({ id: 'n2', titleKey: 'Notice B' }),
    ];
    render(<ModalRenderer notices={notices} />);
    await flushGraceDelay();

    expect(screen.getByText('Notice A')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowRight' });
    });
    await flushGraceDelay();

    expect(screen.getByText('Notice B')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowLeft' });
    });
    await flushGraceDelay();

    expect(screen.getByText('Notice A')).toBeTruthy();
  });

  it('FE-SN-MODAL-013: clicking a dot navigates directly to that page', async () => {
    const notices = [
      makeNotice({ id: 'n1', titleKey: 'Notice A' }),
      makeNotice({ id: 'n2', titleKey: 'Notice B' }),
      makeNotice({ id: 'n3', titleKey: 'Notice C' }),
    ];
    render(<ModalRenderer notices={notices} />);
    await flushGraceDelay();

    expect(screen.getByText('Notice A')).toBeTruthy();

    // Click third dot
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Go to notice 3'));
    });
    await flushGraceDelay();

    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('Notice C')).toBeTruthy();
  });

  it('FE-SN-MODAL-014: non-dismissible notice locks the pager (prev/next/dots disabled)', async () => {
    const notices = [
      makeNotice({ id: 'n1', titleKey: 'Notice A', dismissible: false }),
      makeNotice({ id: 'n2', titleKey: 'Notice B' }),
    ];
    render(<ModalRenderer notices={notices} />);
    await flushGraceDelay();

    const prevBtn = screen.getByLabelText('Previous notice') as HTMLButtonElement;
    const nextBtn = screen.getByLabelText('Next notice') as HTMLButtonElement;
    const dot2 = screen.getByLabelText('Go to notice 2') as HTMLButtonElement;

    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(true);
    expect(dot2.disabled).toBe(true);

    // Arrow keys should also be blocked
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowRight' });
    });
    // Still on page 1 (no grace delay needed because page didn't change)
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('FE-SN-MODAL-015: dismissing a notice does not skip the next one (regression)', async () => {
    const noticeA = makeNotice({ id: 'n-a', titleKey: 'Notice A' });
    const noticeB = makeNotice({ id: 'n-b', titleKey: 'Notice B' });
    const noticeC = makeNotice({ id: 'n-c', titleKey: 'Notice C' });

    useSystemNoticeStore.setState({ notices: [noticeA, noticeB, noticeC], loaded: true });
    const { rerender } = render(<ModalRenderer notices={[noticeA, noticeB, noticeC]} />);
    await flushGraceDelay();

    expect(screen.getByText('Notice A')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();

    // Navigate to last page where X button is available
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Go to notice 3'));
    });
    await flushGraceDelay();

    // Dismiss all from last page — store shrinks
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss'));
      useSystemNoticeStore.setState({ notices: [], loaded: true });
      rerender(<ModalRenderer notices={[]} />);
    });
    await flushGraceDelay();

    // All dismissed — modal should be gone
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('FE-SN-MODAL-017: X button dismisses all notices, not just the current one', async () => {
    const noticeA = makeNotice({ id: 'n-a', titleKey: 'Notice A' });
    const noticeB = makeNotice({ id: 'n-b', titleKey: 'Notice B' });
    useSystemNoticeStore.setState({ notices: [noticeA, noticeB], loaded: true });

    const dismissSpy = vi.spyOn(useSystemNoticeStore.getState(), 'dismiss');
    render(<ModalRenderer notices={[noticeA, noticeB]} />);
    await flushGraceDelay();

    // X button only appears on the last page — navigate there
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Go to notice 2'));
    });
    await flushGraceDelay();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss'));
    });

    expect(dismissSpy).toHaveBeenCalledWith('n-a');
    expect(dismissSpy).toHaveBeenCalledWith('n-b');
    expect(dismissSpy).toHaveBeenCalledTimes(2);
  });

  it('FE-SN-MODAL-018: ESC key dismisses all notices when on last page', async () => {
    const noticeA = makeNotice({ id: 'n-a', titleKey: 'Notice A' });
    const noticeB = makeNotice({ id: 'n-b', titleKey: 'Notice B' });
    useSystemNoticeStore.setState({ notices: [noticeA, noticeB], loaded: true });

    const dismissSpy = vi.spyOn(useSystemNoticeStore.getState(), 'dismiss');
    render(<ModalRenderer notices={[noticeA, noticeB]} />);
    await flushGraceDelay();

    // ESC only works on last page — navigate there first
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Go to notice 2'));
    });
    await flushGraceDelay();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(dismissSpy).toHaveBeenCalledWith('n-a');
    expect(dismissSpy).toHaveBeenCalledWith('n-b');
    expect(dismissSpy).toHaveBeenCalledTimes(2);
  });

  it('FE-SN-MODAL-016: dismissing the only remaining notice closes the modal', async () => {
    const notice = makeNotice({ id: 'solo', titleKey: 'Solo Notice' });
    useSystemNoticeStore.setState({ notices: [notice], loaded: true });

    const { rerender, container } = render(<ModalRenderer notices={[notice]} />);
    await flushGraceDelay();

    expect(screen.getByText('Solo Notice')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss'));
      useSystemNoticeStore.setState({ notices: [], loaded: true });
      rerender(<ModalRenderer notices={[]} />);
    });

    expect(container.firstChild).toBeNull();
  });
});

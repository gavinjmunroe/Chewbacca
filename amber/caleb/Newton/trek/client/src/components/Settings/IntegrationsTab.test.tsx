// FE-COMP-INTEGRATIONS-001 to FE-COMP-INTEGRATIONS-032
import { render, screen, waitFor } from '../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../tests/helpers/msw/server';
import { useAuthStore } from '../../store/authStore';
import { useAddonStore } from '../../store/addonStore';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { buildUser } from '../../../tests/helpers/factories';
import { ToastContainer } from '../shared/Toast';
import IntegrationsTab from './IntegrationsTab';

function enableMcp() {
  seedStore(useAddonStore, {
    addons: [{ id: 'mcp', name: 'MCP', type: 'integration', icon: '', enabled: true }],
    loaded: true,
    loadAddons: vi.fn(),
  });
}

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  clipboardWriteText.mockClear();
  resetAllStores();
  vi.clearAllMocks();
  seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true });
  seedStore(useAddonStore, {
    addons: [],
    loaded: true,
    loadAddons: vi.fn(),
  });
  server.use(
    http.get('/api/auth/mcp-tokens', () => HttpResponse.json({ tokens: [] })),
    http.get('/api/addons', () => HttpResponse.json({ addons: [] })),
    http.get('/api/oauth/clients', () => HttpResponse.json({ clients: [] })),
    http.get('/api/oauth/sessions', () => HttpResponse.json({ sessions: [] })),
  );
});

describe('IntegrationsTab', () => {
  it('FE-COMP-INTEGRATIONS-001: renders without crashing (MCP disabled)', () => {
    render(<IntegrationsTab />);
    expect(document.body).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-002: MCP section is hidden when mcp addon is disabled', () => {
    render(<IntegrationsTab />);
    expect(screen.queryByText('MCP Configuration')).toBeNull();
  });

  it('FE-COMP-INTEGRATIONS-003: MCP section is visible when mcp addon is enabled', async () => {
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
  });

  it('FE-COMP-INTEGRATIONS-004: MCP endpoint URL is displayed', async () => {
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    const codeEl = document.querySelector('code');
    expect(codeEl).not.toBeNull();
    expect(codeEl!.textContent).toContain('/mcp');
  });

  it('FE-COMP-INTEGRATIONS-005: JSON config block is rendered when expanded', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    // Config is collapsed by default — no <pre> yet
    expect(document.querySelector('pre')).toBeNull();
    // Expand by clicking the "Client Configuration" toggle
    await user.click(screen.getByRole('button', { name: /Client Configuration/i }));
    const preEl = document.querySelector('pre');
    expect(preEl).not.toBeNull();
    expect(preEl!.textContent).toContain('mcpServers');
  });

  it('FE-COMP-INTEGRATIONS-006: "no tokens" message shown when token list is empty', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('No tokens yet. Create one to connect MCP clients.');
  });

  it('FE-COMP-INTEGRATIONS-007: token list renders when tokens exist', async () => {
    server.use(
      http.get('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          tokens: [
            { id: 1, name: 'My Token', token_prefix: 'tk_aaa', created_at: '2025-01-01T00:00:00.000Z', last_used_at: null },
            { id: 2, name: 'Other Token', token_prefix: 'tk_bbb', created_at: '2025-01-01T00:00:00.000Z', last_used_at: null },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('My Token');
    await screen.findByText('Other Token');
  });

  it('FE-COMP-INTEGRATIONS-008: clicking "Create New Token" button opens the modal', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    const createBtn = screen.getByRole('button', { name: /Create New Token/i });
    await user.click(createBtn);
    await screen.findByText('Create API Token');
  });

  it('FE-COMP-INTEGRATIONS-009: Create button in modal is disabled when name is empty', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await user.click(screen.getByRole('button', { name: /Create New Token/i }));
    await screen.findByText('Create API Token');
    const modalCreateBtn = screen.getByRole('button', { name: /^Create Token$/i });
    expect(modalCreateBtn).toBeDisabled();
  });

  it('FE-COMP-INTEGRATIONS-010: Create button in modal becomes enabled when name is typed', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await user.click(screen.getByRole('button', { name: /Create New Token/i }));
    await screen.findByText('Create API Token');
    const input = screen.getByPlaceholderText(/Claude Desktop/i);
    await user.type(input, 'My API token');
    const modalCreateBtn = screen.getByRole('button', { name: /^Create Token$/i });
    expect(modalCreateBtn).not.toBeDisabled();
  });

  it('FE-COMP-INTEGRATIONS-011: creating a token calls the API and shows the raw token', async () => {
    server.use(
      http.post('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          token: {
            id: 1,
            name: 'test',
            token_prefix: 'tk_abc',
            created_at: '2025-01-01T00:00:00.000Z',
            raw_token: 'tk_abc...full_secret_token',
          },
        }),
      ),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await user.click(screen.getByRole('button', { name: /Create New Token/i }));
    await screen.findByText('Create API Token');
    const input = screen.getByPlaceholderText(/Claude Desktop/i);
    await user.type(input, 'test');
    await user.click(screen.getByRole('button', { name: /^Create Token$/i }));
    // Raw token should be displayed
    await screen.findByText(/tk_abc\.\.\.full_secret_token/);
    // Warning about one-time display
    expect(screen.getByText(/only be shown once/i)).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-012: "Done" button closes the token-created modal', async () => {
    server.use(
      http.post('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          token: {
            id: 1,
            name: 'test',
            token_prefix: 'tk_abc',
            created_at: '2025-01-01T00:00:00.000Z',
            raw_token: 'tk_abc...full_secret_token',
          },
        }),
      ),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await user.click(screen.getByRole('button', { name: /Create New Token/i }));
    await screen.findByText('Create API Token');
    await user.type(screen.getByPlaceholderText(/Claude Desktop/i), 'test');
    await user.click(screen.getByRole('button', { name: /^Create Token$/i }));
    await screen.findByText('Token Created');
    await user.click(screen.getByRole('button', { name: /^Done$/i }));
    await waitFor(() => {
      expect(screen.queryByText('Token Created')).toBeNull();
    });
  });

  it('FE-COMP-INTEGRATIONS-013: clicking the delete button next to a token opens the confirm modal', async () => {
    server.use(
      http.get('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          tokens: [
            { id: 1, name: 'Delete Me', token_prefix: 'tk_del', created_at: '2025-01-01T00:00:00.000Z', last_used_at: null },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('Delete Me');
    await user.click(screen.getByTitle('Delete Token'));
    await screen.findByText('This token will stop working immediately. Any MCP client using it will lose access.');
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-014: confirming deletion calls DELETE API and removes token from list', async () => {
    let deleteCalled = false;
    server.use(
      http.get('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          tokens: [
            { id: 1, name: 'Delete Me', token_prefix: 'tk_del', created_at: '2025-01-01T00:00:00.000Z', last_used_at: null },
          ],
        }),
      ),
      http.delete('/api/auth/mcp-tokens/1', () => {
        deleteCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('Delete Me');
    await user.click(screen.getByTitle('Delete Token'));
    // There are two "Delete Token" buttons: the trash icon (title) and the confirm button in modal
    const deleteButtons = await screen.findAllByRole('button', { name: /^Delete Token$/i });
    // Click the one in the modal (last one, or the standalone one without title attribute)
    const confirmBtn = deleteButtons.find(btn => !btn.title);
    await user.click(confirmBtn ?? deleteButtons[deleteButtons.length - 1]);
    expect(deleteCalled).toBe(true);
    await waitFor(() => {
      expect(screen.queryByText('Delete Me')).toBeNull();
    });
  });

  it('FE-COMP-INTEGRATIONS-015: copying endpoint URL calls clipboard.writeText', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    // Spy after userEvent.setup() may have replaced navigator.clipboard
    const writeSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const copyBtns = screen.getAllByTitle('Copy');
    await user.click(copyBtns[0]);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('/mcp'));
  });

  it('FE-COMP-INTEGRATIONS-016: copy button shows checkmark icon after copy', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const copyBtns = screen.getAllByTitle('Copy');
    await user.click(copyBtns[0]);
    await waitFor(() => {
      // After copy, icon changes to Check (green). The button should contain an svg with text-green-500
      const btn = copyBtns[0];
      const svg = btn.querySelector('svg');
      expect(svg).toHaveClass('text-green-500');
    });
  });

  it('FE-COMP-INTEGRATIONS-017: cancel button in delete confirm modal closes it without API call', async () => {
    let deleteCalled = false;
    server.use(
      http.get('/api/auth/mcp-tokens', () =>
        HttpResponse.json({
          tokens: [
            { id: 1, name: 'Cancel Token', token_prefix: 'tk_can', created_at: '2025-01-01T00:00:00.000Z', last_used_at: null },
          ],
        }),
      ),
      http.delete('/api/auth/mcp-tokens/1', () => {
        deleteCalled = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('Cancel Token');
    await user.click(screen.getByTitle('Delete Token'));
    await screen.findByRole('button', { name: /^Cancel$/i });
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByText('This token will stop working immediately. Any MCP client using it will lose access.')).toBeNull();
    });
    expect(deleteCalled).toBe(false);
  });

  it('FE-COMP-INTEGRATIONS-018: pressing Enter in the token name input triggers creation', async () => {
    let postCalled = false;
    server.use(
      http.post('/api/auth/mcp-tokens', () => {
        postCalled = true;
        return HttpResponse.json({
          token: {
            id: 1,
            name: 'enter-test',
            token_prefix: 'tk_ent',
            created_at: '2025-01-01T00:00:00.000Z',
            raw_token: 'tk_ent...full',
          },
        });
      }),
    );
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await user.click(screen.getByRole('button', { name: /Create New Token/i }));
    await screen.findByText('Create API Token');
    const input = screen.getByPlaceholderText(/Claude Desktop/i);
    await user.type(input, 'enter-test');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(postCalled).toBe(true);
    });
  });

  it('FE-COMP-INTEGRATIONS-019: default tab is OAuth 2.1 Clients — OAuth hint visible, token list hidden', async () => {
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    // OAuth hint is visible on the default tab
    expect(screen.getByText(/Register OAuth 2\.1 clients/i)).toBeInTheDocument();
    // API Tokens "no tokens" message is not rendered
    expect(screen.queryByText('No tokens yet. Create one to connect MCP clients.')).toBeNull();
  });

  it('FE-COMP-INTEGRATIONS-020: switching tabs toggles content visibility', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    // Default: OAuth hint visible, token list absent
    expect(screen.getByText(/Register OAuth 2\.1 clients/i)).toBeInTheDocument();
    expect(screen.queryByText('No tokens yet. Create one to connect MCP clients.')).toBeNull();
    // Switch to API Tokens tab
    await user.click(screen.getByRole('button', { name: /API Tokens/i }));
    await screen.findByText('No tokens yet. Create one to connect MCP clients.');
    expect(screen.queryByText(/Register OAuth 2\.1 clients/i)).toBeNull();
    // Switch back to OAuth tab
    await user.click(screen.getByRole('button', { name: /OAuth 2\.1 Clients/i }));
    await screen.findByText(/Register OAuth 2\.1 clients/i);
    expect(screen.queryByText('No tokens yet. Create one to connect MCP clients.')).toBeNull();
  });

  it('FE-COMP-INTEGRATIONS-021: OAuth client list renders when clients exist', async () => {
    server.use(
      http.get('/api/oauth/clients', () =>
        HttpResponse.json({
          clients: [
            {
              id: 'client-1',
              client_id: 'clid-abc',
              name: 'My OAuth App',
              redirect_uris: ['http://localhost'],
              allowed_scopes: ['trips:read', 'places:read'],
              created_at: '2025-01-01T00:00:00Z',
            },
          ],
        })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('My OAuth App');
    expect(screen.getByText(/clid-abc/)).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-022: scope expansion toggle shows more/fewer scopes', async () => {
    const user = userEvent.setup();
    const scopes = ['trips:read', 'trips:write', 'places:read', 'places:write', 'budget:read', 'budget:write', 'packing:read'];
    server.use(
      http.get('/api/oauth/clients', () =>
        HttpResponse.json({
          clients: [
            { id: 'c1', client_id: 'cid', name: 'Big App', redirect_uris: ['http://localhost'], allowed_scopes: scopes, created_at: '2025-01-01T00:00:00Z' },
          ],
        })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('Big App');
    // "+2 more" button visible (7 scopes, 5 shown)
    const moreBtn = screen.getByText(/^\+\d+$/);
    await user.click(moreBtn);
    // Show less / collapse button now visible
    expect(screen.getByText('−')).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-023: active OAuth sessions section renders when sessions exist', async () => {
    server.use(
      http.get('/api/oauth/sessions', () =>
        HttpResponse.json({
          sessions: [
            {
              id: 10,
              client_name: 'Claude Desktop',
              scopes: ['trips:read'],
              access_token_expires_at: '2025-12-31T00:00:00Z',
            },
          ],
        })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('Claude Desktop');
    expect(screen.getByText(/trips:read/)).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-024: Create OAuth Client modal opens and shows presets', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');
    expect(screen.getByText('Claude.ai')).toBeInTheDocument();
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
  });

  it('FE-COMP-INTEGRATIONS-025: clicking a preset fills form fields', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');
    // Presets render as buttons — click "Claude.ai" preset
    const presetBtns = screen.getAllByRole('button', { name: /Claude\.ai/i });
    await user.click(presetBtns[0]);
    // Name field should be filled with 'Claude.ai'
    const nameInput = screen.getByPlaceholderText(/Claude Web, My MCP App/i);
    expect((nameInput as HTMLInputElement).value).toBe('Claude.ai');
  });

  it('FE-COMP-INTEGRATIONS-026: creating client shows success view with client_id and secret', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/oauth/clients', () =>
        HttpResponse.json({
          client: {
            id: 'new-id',
            client_id: 'clid-new',
            client_secret: 'secret-value',
            name: 'Test Client',
            redirect_uris: ['http://localhost'],
            allowed_scopes: ['trips:read'],
            created_at: '2025-01-01T00:00:00Z',
          },
        })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');

    const nameInput = screen.getByPlaceholderText(/Claude Web, My MCP App/i);
    await user.type(nameInput, 'Test Client');
    const uriInput = screen.getByPlaceholderText(/https:\/\/your-app/i);
    await user.type(uriInput, 'http://localhost');
    await user.click(screen.getByRole('button', { name: /Register Client/i }));
    // Success view shows client credentials (there may be multiple matches in list + modal)
    await screen.findAllByText(/clid-new/);
    const secretEls = await screen.findAllByText(/secret-value/);
    expect(secretEls.length).toBeGreaterThan(0);
  });

  it('FE-COMP-INTEGRATIONS-027: Done button closes created-client modal', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/oauth/clients', () =>
        HttpResponse.json({
          client: {
            id: 'n2',
            client_id: 'clid-n2',
            client_secret: 'secret-n2',
            name: 'TC2',
            redirect_uris: ['http://localhost'],
            allowed_scopes: ['trips:read'],
            created_at: '2025-01-01T00:00:00Z',
          },
        })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');
    await user.type(screen.getByPlaceholderText(/Claude Web, My MCP App/i), 'TC2');
    await user.type(screen.getByPlaceholderText(/https:\/\/your-app/i), 'http://localhost');
    await user.click(screen.getByRole('button', { name: /Register Client/i }));
    await screen.findAllByText(/clid-n2/);
    // Check the "Client Registered" modal title is visible before Done
    expect(screen.getByText('Client Registered')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Done$/i }));
    await waitFor(() => {
      expect(screen.queryByText('Client Registered')).toBeNull();
    });
  });

  it('FE-COMP-INTEGRATIONS-028: delete OAuth client confirmation removes client from list', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/oauth/clients', () =>
        HttpResponse.json({
          clients: [
            { id: 'del-1', client_id: 'cid-del', name: 'Delete Me', redirect_uris: ['http://localhost'], allowed_scopes: ['trips:read'], created_at: '2025-01-01T00:00:00Z' },
          ],
        })
      ),
      http.delete('/api/oauth/clients/del-1', () => HttpResponse.json({ success: true }))
    );
    enableMcp();
    render(<><ToastContainer /><IntegrationsTab /></>);
    await screen.findByText('Delete Me');
    await user.click(screen.getByTitle('Delete Client'));
    // Confirmation modal
    await screen.findByRole('heading', { name: 'Delete Client' });
    const confirmBtns = screen.getAllByRole('button', { name: /Delete Client/i });
    // Modal confirm button is last in DOM (modal renders after list)
    await user.click(confirmBtns[confirmBtns.length - 1]);
    await waitFor(() => {
      expect(screen.queryByText('Delete Me')).toBeNull();
    });
  });

  it('FE-COMP-INTEGRATIONS-029: rotate secret confirmation shows new secret', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/oauth/clients', () =>
        HttpResponse.json({
          clients: [
            { id: 'rot-1', client_id: 'cid-rot', name: 'Rotate Me', redirect_uris: ['http://localhost'], allowed_scopes: ['trips:read'], created_at: '2025-01-01T00:00:00Z' },
          ],
        })
      ),
      http.post('/api/oauth/clients/rot-1/rotate', () =>
        HttpResponse.json({ client_secret: 'new-rotated-secret' })
      )
    );
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('Rotate Me');
    await user.click(screen.getByTitle('Rotate Secret'));
    await screen.findByText('Rotate Secret');
    // Confirm — button text is 'Rotate'
    const rotateBtns = screen.getAllByRole('button', { name: /^Rotate$/i });
    await user.click(rotateBtns[rotateBtns.length - 1]);
    await screen.findByText(/new-rotated-secret/);
  });

  it('FE-COMP-INTEGRATIONS-030: revoke OAuth session removes it from list', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/oauth/sessions', () =>
        HttpResponse.json({
          sessions: [
            { id: 99, client_name: 'Revoke App', scopes: ['trips:read'], access_token_expires_at: '2025-12-31T00:00:00Z' },
          ],
        })
      ),
      http.delete('/api/oauth/sessions/99', () => HttpResponse.json({ success: true }))
    );
    enableMcp();
    render(<><ToastContainer /><IntegrationsTab /></>);
    await screen.findByText('Revoke App');
    await user.click(screen.getByText('Revoke'));
    // Confirmation modal
    await screen.findByText('Revoke Session');
    const revokeBtns = screen.getAllByRole('button', { name: /^Revoke$/i });
    // Modal confirm button is last in DOM
    await user.click(revokeBtns[revokeBtns.length - 1]);
    await waitFor(() => {
      expect(screen.queryByText('Revoke App')).toBeNull();
    });
  });

  it('FE-COMP-INTEGRATIONS-031: Register Client button disabled when name or URI is empty', async () => {
    const user = userEvent.setup();
    enableMcp();
    render(<IntegrationsTab />);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');
    const createBtn = screen.getByRole('button', { name: /Register Client/i });
    expect(createBtn).toBeDisabled();
    // Type only name, not URI → still disabled
    await user.type(screen.getByPlaceholderText(/Claude Web, My MCP App/i), 'Test');
    expect(createBtn).toBeDisabled();
  });

  it('FE-COMP-INTEGRATIONS-032: error toast shown when create OAuth client fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/oauth/clients', () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 })
      )
    );
    enableMcp();
    render(<><ToastContainer /><IntegrationsTab /></>);
    await screen.findByText('MCP Configuration');
    await user.click(screen.getByRole('button', { name: /New Client/i }));
    await screen.findByText('Register OAuth Client');
    await user.type(screen.getByPlaceholderText(/Claude Web, My MCP App/i), 'Fail Client');
    await user.type(screen.getByPlaceholderText(/https:\/\/your-app/i), 'http://localhost');
    await user.click(screen.getByRole('button', { name: /Register Client/i }));
    await screen.findByText(/Failed to register/i);
  });
});

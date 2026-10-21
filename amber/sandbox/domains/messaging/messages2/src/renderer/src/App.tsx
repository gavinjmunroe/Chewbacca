import { useMessagesApp } from "./lib/use-messages";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";

function App(): JSX.Element {
  const {
    state,
    selectChat,
    setSearch,
    send,
    retrySend,
    dismissFailedSend,
    loadOlderMessages,
    togglePin,
    retryPermissions,
    pickAttachments,
    dismissWatcherError,
    selectedChat,
  } = useMessagesApp();

  // Loading: pre-permission check
  if (!state.permissionsChecked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black">
        <div className="titlebar-drag absolute inset-x-0 top-0 h-12" />
        <div className="text-sm text-zinc-500">Loading…</div>
      </div>
    );
  }

  // Error: missing Full Disk Access or other permission failure
  if (!state.permissions || !state.permissions.canReadDatabase) {
    return (
      <Onboarding
        permissions={
          state.permissions ?? {
            canReadDatabase: false,
            canSendMessages: false,
            databasePath: "",
          }
        }
        onRetry={retryPermissions}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-white">
      <Sidebar
        chats={state.chats}
        loading={state.chatsLoading}
        selectedChatId={state.selectedChatId}
        search={state.search}
        onSearch={setSearch}
        onSelect={selectChat}
        onTogglePin={togglePin}
      />
      <ThreadView
        chat={selectedChat}
        messages={state.messages}
        loading={state.messagesLoading}
        loadingOlder={state.loadingOlder}
        hasMoreOlder={state.hasMoreOlder}
        sendError={state.sendError}
        watcherError={state.watcherError}
        onSend={send}
        onRetrySend={retrySend}
        onDismissFailedSend={dismissFailedSend}
        onLoadOlder={loadOlderMessages}
        onPickAttachments={pickAttachments}
        onDismissWatcherError={dismissWatcherError}
      />
    </div>
  );
}

export default App;

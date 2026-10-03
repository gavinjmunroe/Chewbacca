from tools.codex_hooks import dispatch

class ChatGPTRuntime:
    def handle(self, message: dict) -> dict:
        payload = {
            "hook_event_name": message.get("hook_event_name", "UserPromptSubmit"),
            "cwd": message.get("cwd"),
            "session_id": message.get("session_id", "chatgpt"),
            **message,
        }
        return dispatch(payload)

/**
 * Todoist tools: direct REST API integration for task management.
 * Provides Claude tool definitions and action execution.
 */

import { TODOIST_API_KEY, TOOLS_CACHE_DURATION } from "../constants.js";
import { getSecret } from "../secrets.js";

// Cache for tools
let todoistTools = null;
let todoistToolsLastFetched = null;

async function resolveTodoistKey(tenant) {
  if (tenant) {
    const key = await getSecret(tenant, "TODOIST_API_KEY", {
      fallbackEnv: "TODOIST_API_KEY",
    });
    if (key) return key;
  }
  return TODOIST_API_KEY;
}

export async function todoistRequest(
  endpoint,
  method = "GET",
  body = null,
  tenant = null,
) {
  const apiKey = await resolveTodoistKey(tenant);
  const response = await fetch(`https://api.todoist.com/api/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Todoist API error: ${response.status} - ${error}`);
  }

  if (response.status === 204) return { success: true };
  return await response.json();
}

export async function getTodoistTools() {
  // Return cached tools if still fresh
  if (
    todoistTools &&
    todoistToolsLastFetched &&
    Date.now() - todoistToolsLastFetched < TOOLS_CACHE_DURATION
  ) {
    return todoistTools;
  }

  // Define Todoist tools in Claude format
  const tools = [
    {
      name: "todoist_create_task",
      description:
        "Create a new task in Todoist. Use this to add tasks to the user's todo list.",
      input_schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The task content/title",
          },
          description: {
            type: "string",
            description: "A detailed description of the task",
          },
          due_string: {
            type: "string",
            description:
              'Human-friendly due date like "tomorrow", "next Monday", "Jan 23"',
          },
          priority: {
            type: "integer",
            description: "Priority from 1 (normal) to 4 (urgent)",
            enum: [1, 2, 3, 4],
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to add to the task",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "todoist_get_tasks",
      description:
        "Get active tasks from Todoist. Use this to check the user's todo list.",
      input_schema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description:
              'Filter tasks (e.g., "today", "p1" for priority 1, or a project name)',
          },
        },
      },
    },
    {
      name: "todoist_complete_task",
      description: "Mark a task as complete in Todoist.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The task ID to complete",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "todoist_update_task",
      description: "Update an existing task in Todoist.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The task ID to update",
          },
          content: {
            type: "string",
            description: "New task content/title",
          },
          description: {
            type: "string",
            description: "New task description",
          },
          due_string: {
            type: "string",
            description: "New due date",
          },
          priority: {
            type: "integer",
            description: "New priority (1-4)",
          },
        },
        required: ["id"],
      },
    },
  ];

  todoistTools = tools;
  todoistToolsLastFetched = Date.now();
  console.log(`   Loaded ${tools.length} Todoist tools`);

  return tools;
}

export async function executeTodoistAction(toolName, toolInput, tenant = null) {
  try {
    console.log(`   Executing ${toolName}...`);

    let result;
    switch (toolName) {
      case "todoist_create_task":
        result = await todoistRequest("tasks", "POST", toolInput, tenant);
        break;

      case "todoist_get_tasks": {
        const filter = toolInput.filter
          ? `?filter=${encodeURIComponent(toolInput.filter)}`
          : "";
        result = await todoistRequest(`tasks${filter}`, "GET", null, tenant);
        break;
      }

      case "todoist_complete_task":
        await todoistRequest(`tasks/${toolInput.id}/close`, "POST", null, tenant);
        result = { success: true, message: `Task ${toolInput.id} completed` };
        break;

      case "todoist_update_task": {
        const { id, ...updateData } = toolInput;
        result = await todoistRequest(`tasks/${id}`, "POST", updateData, tenant);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    console.log(`   ${toolName} completed`);
    return result;
  } catch (error) {
    console.error(`   Error executing ${toolName}:`, error.message);
    throw error;
  }
}

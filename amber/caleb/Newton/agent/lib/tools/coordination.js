/**
 * Group coordination tools: tasks, polls, check-ins, event planning.
 * Many-to-many intelligence through conversation.
 *
 * "Create a poll: where should we eat tonight?"
 * "Assign Sagar to book the hotel"
 * "Do a health check-in for everyone in this group"
 * "What's everyone's status on the project?"
 */

import { sbGet, sbInsert, sbUpsert, sbQuery } from "../data.js";

export const COORDINATION_TOOLS = [
  {
    name: "create_group_task",
    description:
      "Create a task for one or more people in a group. Use when someone says 'assign X to do Y' or 'we need someone to do X'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignedTo: {
          type: "array",
          items: { type: "string" },
          description: "Phone handles of people assigned",
        },
        dueDate: { type: "string", description: "ISO date" },
        healthDimension: {
          type: "string",
          description: "Which health dimension this relates to",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_poll",
    description:
      "Create a poll for the group. Use when someone says 'let's vote on X' or 'where should we eat'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The question being asked" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Poll options",
        },
      },
      required: ["title", "options"],
    },
  },
  {
    name: "vote_poll",
    description: "Cast a vote on an existing poll",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the poll" },
        option: { type: "string", description: "Which option to vote for" },
        voter: { type: "string", description: "Phone handle of the voter" },
      },
      required: ["taskId", "option", "voter"],
    },
  },
  {
    name: "group_health_checkin",
    description:
      "Initiate a health check-in for everyone in the group. Asks each person to rate their 6 dimensions.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Custom check-in message (optional)",
        },
      },
    },
  },
  {
    name: "list_group_tasks",
    description: "List all tasks, polls, and check-ins for a group",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in_progress", "done", "all"],
          description: "Filter by status",
        },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a group task as done",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "schedule_group_event",
    description:
      "Schedule an event for the group. Can check availability across participants' calendars.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "ISO date" },
        time: { type: "string", description: "Time, e.g. '7:00 PM'" },
        location: { type: "string" },
        description: { type: "string" },
        healthDimension: { type: "string" },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "who_owes_who",
    description:
      "Calculate who owes whom across all shared expenses in a trip or group. Simplifies debts.",
    input_schema: {
      type: "object",
      properties: { tripId: { type: "string" } },
      required: ["tripId"],
    },
  },
];

export async function executeCoordinationTool(toolName, input, context = {}) {
  const groupId = context.groupId || null;
  const from = context.from || null;

  switch (toolName) {
    case "create_group_task": {
      await sbInsert("group_tasks", {
        group_id: groupId,
        title: input.title,
        description: input.description || null,
        type: "task",
        assigned_to: input.assignedTo || [],
        due_date: input.dueDate || null,
        health_dimension: input.healthDimension || null,
        created_by: from,
      });
      return { ok: true, title: input.title, assignedTo: input.assignedTo };
    }

    case "create_poll": {
      const pollOptions = input.options.map((opt) => ({
        option: opt,
        votes: [],
      }));
      await sbInsert("group_tasks", {
        group_id: groupId,
        title: input.title,
        type: "poll",
        poll_options: pollOptions,
        created_by: from,
      });
      return { ok: true, title: input.title, options: input.options };
    }

    case "vote_poll": {
      const poll = await sbGet("group_tasks", `id=eq.${input.taskId}`);
      if (!poll) return { error: "Poll not found" };
      const options = poll.poll_options || [];
      const opt = options.find(
        (o) => o.option.toLowerCase() === input.option.toLowerCase(),
      );
      if (!opt) return { error: `Option "${input.option}" not found` };
      if (!opt.votes.includes(input.voter)) {
        opt.votes.push(input.voter);
      }
      await sbUpsert("group_tasks", {
        id: input.taskId,
        poll_options: options,
      });
      return { ok: true, option: opt.option, voteCount: opt.votes.length };
    }

    case "group_health_checkin": {
      await sbInsert("group_tasks", {
        group_id: groupId,
        title:
          input.message ||
          "How is everyone doing? Rate your 6 dimensions (0-10): social, financial, intellectual, spiritual, physical, emotional",
        type: "checkin",
        responses: {},
        created_by: from,
      });
      return {
        ok: true,
        message: "Health check-in created. Everyone in the group can respond.",
      };
    }

    case "list_group_tasks": {
      let filter = `group_id=eq.${encodeURIComponent(groupId || "")}`;
      if (input.status && input.status !== "all") {
        filter += `&status=eq.${input.status}`;
      }
      const tasks = await sbQuery("group_tasks", filter, {
        limit: 20,
        order: "created_at.desc",
      });
      return { tasks };
    }

    case "complete_task": {
      await sbUpsert("group_tasks", { id: input.taskId, status: "done" });
      return { ok: true };
    }

    case "schedule_group_event": {
      await sbInsert("group_tasks", {
        group_id: groupId,
        title: input.title,
        description: `${input.date} ${input.time || ""} at ${input.location || "TBD"}\n${input.description || ""}`,
        type: "event",
        health_dimension: input.healthDimension || null,
        due_date: input.date,
        created_by: from,
      });
      return { ok: true, title: input.title, date: input.date };
    }

    case "who_owes_who": {
      const items = await sbQuery("budget_items", `trip_id=eq.${input.tripId}`);
      if (!items.length)
        return { debts: [], message: "No expenses recorded yet." };

      // Calculate net balances
      const balances = {};
      const trip = await sbGet("trips", `id=eq.${input.tripId}`);
      const participants = (trip?.participants || []).map((p) => p.handle);

      for (const item of items) {
        const payer = item.paid_by;
        const amount = Number(item.amount || 0);
        const splits = item.split_with || [];

        if (splits.length > 0) {
          // Explicit split
          for (const s of splits) {
            balances[s.handle] =
              (balances[s.handle] || 0) - Number(s.amount || 0);
            balances[payer] = (balances[payer] || 0) + Number(s.amount || 0);
          }
        } else if (payer && participants.length > 0) {
          // Even split among all participants
          const perPerson = amount / participants.length;
          for (const p of participants) {
            if (p === payer) {
              balances[p] = (balances[p] || 0) + (amount - perPerson);
            } else {
              balances[p] = (balances[p] || 0) - perPerson;
            }
          }
        }
      }

      // Simplify debts
      const debts = [];
      const debtors = Object.entries(balances)
        .filter(([, v]) => v < -0.01)
        .sort((a, b) => a[1] - b[1]);
      const creditors = Object.entries(balances)
        .filter(([, v]) => v > 0.01)
        .sort((a, b) => b[1] - a[1]);

      let i = 0,
        j = 0;
      while (i < debtors.length && j < creditors.length) {
        const [debtor, debtAmt] = debtors[i];
        const [creditor, creditAmt] = creditors[j];
        const settleAmt = Math.min(Math.abs(debtAmt), creditAmt);
        debts.push({
          from: debtor,
          to: creditor,
          amount: Math.round(settleAmt * 100) / 100,
        });
        debtors[i] = [debtor, debtAmt + settleAmt];
        creditors[j] = [creditor, creditAmt - settleAmt];
        if (Math.abs(debtors[i][1]) < 0.01) i++;
        if (creditors[j][1] < 0.01) j++;
      }

      return {
        debts,
        totalSpent: items.reduce((s, i) => s + Number(i.amount || 0), 0),
      };
    }

    default:
      return { error: `Unknown coordination tool: ${toolName}` };
  }
}

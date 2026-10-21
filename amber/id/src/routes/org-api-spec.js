/**
 * THE MACHINE-READABLE DESCRIPTION OF THE DOOR.
 *
 * Microsoft Copilot does not consume an API by being told about it in prose.
 * Copilot Studio imports an OpenAPI document and turns it into a custom
 * connector; an agent then calls those operations on the user's behalf. The
 * same document is what Zapier, Make, Postman and every code generator want,
 * and it is what an LLM needs in order to use this API without somebody
 * writing a wrapper first.
 *
 * So the integration a client is asking for when they say "Copilot support"
 * is, concretely, this file plus the routes it describes. Writing a bespoke
 * Microsoft-shaped endpoint instead would serve one product; a correct
 * OpenAPI document serves that one and everything else that has ever learned
 * to read one.
 *
 * WHY IT IS PUBLIC AND WHY THAT IS SAFE. Copilot Studio fetches the document
 * during setup, before any credential exists, so an authenticated spec cannot
 * be imported. What it contains is the SHAPE of the API -- paths, fields,
 * types -- and nothing about any company: no names, no ids, no data, no
 * secrets. Every operation it describes still demands a key at call time and
 * still answers 401 without one. A door's dimensions are not its lock.
 *
 * BIDIRECTIONAL, AND THE DIRECTIONS ARE NOT SYMMETRIC. Reading needs `read`
 * and is limited to work the company has made company-wide. Writing needs
 * `write` and is limited to posting. A connector cannot delete anything, edit
 * anything somebody else wrote, change the roster, or read a private group --
 * not because the spec omits those operations but because the API has none,
 * which is the only version of that promise worth making.
 */

/** Bumped when the shape changes, so an imported connector can be diffed. */
const SPEC_VERSION = "1.0.0";

const ERROR = {
  type: "object",
  properties: {
    error: { type: "string" },
    need: { type: "string" },
  },
};

const PERSON = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string", nullable: true },
    email: { type: "string", nullable: true },
    role: { type: "string", enum: ["admin", "member"] },
    status: { type: "string" },
    title: { type: "string", nullable: true },
    joinedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const GROUP = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    purpose: { type: "string", nullable: true },
    memberCount: { type: "integer" },
  },
};

const POST = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    kind: { type: "string", enum: ["update", "question", "answer", "intro"] },
    title: { type: "string", nullable: true },
    body: { type: "string" },
    created_at: { type: "string", format: "date-time" },
    author_name: { type: "string", nullable: true },
    source: {
      type: "string",
      nullable: true,
      description:
        "Set when a machine wrote this, naming the key that did. author_name is null in that case.",
    },
  },
};

const FILE = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    filename: { type: "string" },
    content_type: { type: "string" },
    byte_size: { type: "integer", nullable: true },
    created_at: { type: "string", format: "date-time" },
    uploaded_by_name: { type: "string", nullable: true },
  },
};

const CONNECTION = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    label: { type: "string" },
    url: { type: "string" },
    provider: { type: "string" },
    note: { type: "string", nullable: true },
    group_name: { type: "string", nullable: true },
  },
};

/** 401/403 on every operation, written once. */
const AUTH_RESPONSES = {
  401: { description: "No key, or a key that is not valid.", content: { "application/json": { schema: ERROR } } },
  403: {
    description: "The key is valid but lacks the scope this operation needs.",
    content: { "application/json": { schema: ERROR } },
  },
  503: {
    description: "The key could not be checked right now. Retry; do not rotate the key.",
    content: { "application/json": { schema: ERROR } },
  },
};

const listOp = (id, summary, description, name, schema) => ({
  operationId: id,
  summary,
  description,
  parameters: [
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
  ],
  responses: {
    200: {
      description: summary,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              [name]: { type: "array", items: schema },
              count: { type: "integer" },
            },
          },
        },
      },
    },
    ...AUTH_RESPONSES,
  },
});

export function buildOpenApi(baseUrl) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Amber workspace",
      version: SPEC_VERSION,
      description: [
        "Read and write one company's workspace.",
        "",
        "AUTHENTICATION. Every operation takes a company API key as a bearer",
        "token, minted by an admin on the Connectors page. A key belongs to the",
        "company rather than to a person, so it keeps working after whoever",
        "created it leaves.",
        "",
        "WHAT A KEY CAN SEE, which is the thing worth reading before you build",
        "anything on this: only work the company has addressed to everybody.",
        "A key has no identity inside the workspace, so content scoped to a",
        "group or to named individuals is not hidden from it — it is outside",
        "what the key can express a claim to, and no parameter changes that.",
        "",
        "SCOPES. `read` for every GET. `write` for posting. `admin` exists and",
        "is not used by any operation here.",
      ].join("\n"),
      contact: { name: "Amber Intelligence" },
    },
    servers: [{ url: baseUrl, description: "This workspace's API" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "A company API key: Authorization: Bearer amberorg_live_…  Minted on the Connectors page.",
        },
      },
      schemas: { Person: PERSON, Group: GROUP, Post: POST, File: FILE, Connection: CONNECTION, Error: ERROR },
    },
    paths: {
      "/v1/api/whoami": {
        get: {
          operationId: "whoami",
          summary: "Which company this key belongs to, and what it may do",
          description:
            "The first call to make when setting up an integration: it confirms the key works and names the company before anything else is attempted.",
          responses: {
            200: {
              description: "The key's company and scopes.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      org: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          name: { type: "string" },
                          slug: { type: "string" },
                        },
                      },
                      key: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          name: { type: "string" },
                          scopes: { type: "array", items: { type: "string" } },
                        },
                      },
                      reads: { type: "string" },
                    },
                  },
                },
              },
            },
            ...AUTH_RESPONSES,
          },
        },
      },

      "/v1/api/people": {
        get: listOp(
          "listPeople",
          "Everybody in the company",
          "The roster, with roles. Use this to resolve a name an assistant was asked about into somebody who actually works here.",
          "people",
          PERSON,
        ),
      },

      "/v1/api/groups": {
        get: listOp(
          "listGroups",
          "The company's groups",
          "Teams, with how many people are in each. Membership itself is not exposed to a key.",
          "groups",
          GROUP,
        ),
      },

      "/v1/api/posts": {
        get: listOp(
          "listPosts",
          "Company-wide messages, newest first",
          "What the company has said to everybody. Anything addressed to a group or a person is not included.",
          "posts",
          POST,
        ),
        post: {
          operationId: "createPost",
          summary: "Post a message to the whole company",
          description: [
            "Writes into the company feed. Requires the `write` scope.",
            "",
            "The post is attributed to the KEY, not to a person: the author is",
            "recorded as empty and `source` carries the key's name, so the feed",
            "shows it as written by the integration. This is deliberate —",
            "putting an automated message in a colleague's name is the kind of",
            "thing people only notice once it has caused an argument.",
          ].join("\n"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["body"],
                  properties: {
                    body: { type: "string", description: "The message. Line breaks are kept." },
                    title: { type: "string", nullable: true, description: "Optional heading." },
                    kind: { type: "string", enum: ["update", "question"], default: "update" },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: "Posted.",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { post: POST } },
                },
              },
            },
            400: { description: "An empty body.", content: { "application/json": { schema: ERROR } } },
            ...AUTH_RESPONSES,
          },
        },
      },

      "/v1/api/files": {
        get: listOp(
          "listFiles",
          "Company-wide files",
          "Metadata only — filename, type, size, who uploaded it. File contents are not served to a key.",
          "files",
          FILE,
        ),
      },

      "/v1/api/connections": {
        get: listOp(
          "listConnections",
          "The links this company keeps",
          "Where the company's work lives: repos, drives, CRM views. Useful for answering 'where is X' without a human.",
          "connections",
          CONNECTION,
        ),
      },

      "/v1/api/export": {
        get: {
          operationId: "exportWorkspace",
          summary: "Everything the key may read, as one document",
          description:
            "People, groups, company-wide posts and files, and the link map, in a single response. Intended as both a backup and the grounding payload for an assistant.",
          responses: {
            200: {
              description: "The whole readable workspace.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      exportedAt: { type: "string", format: "date-time" },
                      org: { type: "object" },
                      scope: { type: "string" },
                      people: { type: "array", items: PERSON },
                      groups: { type: "array", items: GROUP },
                      posts: { type: "array", items: POST },
                      files: { type: "array", items: FILE },
                      connections: { type: "array", items: CONNECTION },
                    },
                  },
                },
              },
            },
            ...AUTH_RESPONSES,
          },
        },
      },
    },
  };
}

export function registerOrgApiSpecRoutes(app) {
  /**
   * Unauthenticated, because Copilot Studio fetches it before a credential
   * exists. It describes the shape of the API and contains no company's data.
   */
  app.get("/v1/api/openapi.json", async (request, reply) => {
    /*
     * The server URL is derived from the request rather than configured,
     * so the document is correct on whatever host it was fetched from --
     * a hardcoded base is the usual reason an imported connector points at
     * staging forever.
     */
    const proto = String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
    reply.header("cache-control", "public, max-age=300");
    reply.header("access-control-allow-origin", "*");
    return buildOpenApi(`${proto}://${host}`);
  });
}

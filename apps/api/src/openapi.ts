/**
 * The API contract is kept in source control rather than generated from a
 * running service. This makes the public documentation deterministic, easy to
 * review, and safe to serve from every deployment target (Node, Docker, and
 * Vercel Functions alike).
 */

const scopeValues = [
  "rooms:read",
  "rooms:write",
  "messages:read",
  "messages:write",
  "artifacts:read",
  "artifacts:write",
  "orgs:read",
  "orgs:write",
  "admin:*",
];

const schema = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (body: Record<string, unknown>) => ({ "application/json": { schema: body } });
const response = (description: string, body?: Record<string, unknown>) =>
  body ? { description, content: json(body) } : { description };
const pathParameter = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});
const queryParameter = (name: string, description: string, required = false, format?: string) => ({
  name,
  in: "query",
  required,
  description,
  schema: { type: "string", ...(format ? { format } : {}) },
});

const errors = {
  BadRequest: response("The request is invalid for the current resource state.", schema("Error")),
  Unauthorized: response("Authentication is missing, expired, or invalid.", schema("Error")),
  Forbidden: response("The authenticated identity does not satisfy the room or organization policy.", schema("Error")),
  NotFound: response(
    "The requested resource does not exist or is intentionally not visible to this caller.",
    schema("Error"),
  ),
  Conflict: response("The request conflicts with an existing resource.", schema("Error")),
  Validation: response("One or more request fields failed validation.", schema("Error")),
  RateLimited: response("The rate limit was exceeded. Retry after the returned delay.", schema("Error")),
};

const sessionSecurity = [{ sessionCookie: [] }];
const identitySecurity = [{ sessionCookie: [] }, { personalAccessToken: [] }];

export type OpenApiDocumentOptions = {
  /** The public origin used by the documentation page that requested the spec. */
  serverUrl: string;
  /** The configured OIDC issuer, surfaced for implementers. */
  issuer: string;
};

export function createOpenApiDocument({ serverUrl, issuer }: OpenApiDocumentOptions) {
  return {
    openapi: "3.1.1",
    info: {
      title: "Threadline API",
      version: "1.0.0",
      summary: "Identity, authorization, and persistent collaboration resources for Threadline.",
      description:
        "Threadline is a room-centered engineering workspace. This API provides browser session authentication, scoped personal access tokens, ABAC-protected organizations and rooms, calendar/activity data, and a first-party OpenID Connect provider.\n\n" +
        "Use a browser session for interactive product calls. Automation can send `Authorization: Bearer tl_pat_…`; every protected operation documents its required scope. OIDC endpoints follow Authorization Code + PKCE and intentionally do not support implicit or password grants.\n\n" +
        "All timestamps are ISO 8601 UTC strings. All IDs are UUIDs unless noted otherwise. Errors use the shared `Error` schema.",
      contact: { name: "Threadline Engineering", url: "https://github.com/hoangsonw/threadline" },
      license: { name: "Private / proprietary" },
    },
    servers: [
      { url: serverUrl, description: "The API origin currently serving this documentation." },
      { url: issuer, description: "Configured OpenID Connect issuer." },
    ].filter((server, index, all) => all.findIndex((candidate) => candidate.url === server.url) === index),
    tags: [
      { name: "Service", description: "Service health and API contract discovery." },
      { name: "Authentication", description: "Password authentication, sessions, recovery, and verification." },
      {
        name: "Organizations",
        description: "Organization-scoped resources protected by attribute-based access control.",
      },
      { name: "Rooms", description: "Rooms, memberships, activity, and live-session tickets." },
      { name: "Personal access tokens", description: "Long-lived scoped credentials for trusted automation." },
      { name: "OIDC", description: "First-party OpenID Connect Authorization Code + PKCE endpoints." },
      { name: "Internal", description: "Service-to-service endpoints. Never call these from a browser." },
    ],
    externalDocs: {
      description: "Threadline deployment guide",
      url: "https://github.com/hoangsonw/threadline/tree/main/docs",
    },
    paths: {
      "/health": {
        get: {
          tags: ["Service"],
          operationId: "getHealth",
          summary: "Read service health",
          description: "Unauthenticated liveness endpoint. Suitable for load balancers and deployment checks.",
          responses: { "200": response("The service is available.", schema("Health")) },
        },
      },
      "/v1/auth/register": {
        post: {
          tags: ["Authentication"],
          operationId: "register",
          summary: "Create an account",
          description:
            "Creates a user and a browser session only — the account starts with no organization. A verification action is queued when account-action delivery is configured. Direct the person to `POST /v1/orgs` or `POST /v1/join` next.",
          requestBody: { required: true, content: json(schema("RegistrationInput")) },
          responses: {
            "201": response("Account created; a session cookie is set.", schema("RegistrationResponse")),
            "409": errors.Conflict,
            "422": errors.Validation,
            "429": errors.RateLimited,
          },
        },
      },
      "/v1/auth/login": {
        post: {
          tags: ["Authentication"],
          operationId: "login",
          summary: "Start a browser session",
          description: "Validates an email/password pair and sets the HttpOnly `threadline_session` cookie.",
          requestBody: { required: true, content: json(schema("LoginInput")) },
          responses: {
            "200": response("Authenticated user; a session cookie is set.", schema("LoginResponse")),
            "401": errors.Unauthorized,
            "422": errors.Validation,
            "429": errors.RateLimited,
          },
        },
      },
      "/v1/auth/logout": {
        post: {
          tags: ["Authentication"],
          operationId: "logout",
          summary: "Revoke the current browser session",
          security: sessionSecurity,
          responses: { "204": response("The session cookie was cleared."), "401": errors.Unauthorized },
        },
      },
      "/v1/auth/password": {
        post: {
          tags: ["Authentication"],
          operationId: "changePassword",
          summary: "Change the signed-in user’s password",
          description: "Revokes every other active browser session after a successful change.",
          security: sessionSecurity,
          requestBody: { required: true, content: json(schema("ChangePasswordInput")) },
          responses: { "204": response("Password changed."), "401": errors.Unauthorized, "422": errors.Validation },
        },
      },
      "/v1/auth/password-reset/request": {
        post: {
          tags: ["Authentication"],
          operationId: "requestPasswordReset",
          summary: "Request a password recovery link",
          description:
            "Always returns an accepted response to avoid disclosing whether an email address has an account.",
          requestBody: { required: true, content: json(schema("EmailInput")) },
          responses: {
            "202": response("The request was accepted.", schema("AcceptedMessage")),
            "422": errors.Validation,
            "429": errors.RateLimited,
          },
        },
      },
      "/v1/auth/password-reset/confirm": {
        post: {
          tags: ["Authentication"],
          operationId: "confirmPasswordReset",
          summary: "Set a new password from a recovery token",
          description: "Consumes the one-time token and revokes all active sessions for the account.",
          requestBody: { required: true, content: json(schema("ConfirmPasswordResetInput")) },
          responses: {
            "204": response("Password reset completed."),
            "400": errors.BadRequest,
            "422": errors.Validation,
          },
        },
      },
      "/v1/auth/email-verification/request": {
        post: {
          tags: ["Authentication"],
          operationId: "requestEmailVerification",
          summary: "Request a verification link for the signed-in user",
          security: sessionSecurity,
          responses: {
            "202": response("The request was accepted.", schema("AcceptedMessage")),
            "401": errors.Unauthorized,
          },
        },
      },
      "/v1/auth/email-verification/confirm": {
        post: {
          tags: ["Authentication"],
          operationId: "confirmEmailVerification",
          summary: "Confirm an email address from a verification token",
          requestBody: { required: true, content: json(schema("VerificationTokenInput")) },
          responses: { "204": response("Email address verified."), "400": errors.BadRequest, "422": errors.Validation },
        },
      },
      "/v1/auth/me": {
        get: {
          tags: ["Authentication"],
          operationId: "getCurrentUser",
          summary: "Read the signed-in user and their organizations",
          security: sessionSecurity,
          responses: {
            "200": response("Current identity.", schema("CurrentUserResponse")),
            "401": errors.Unauthorized,
          },
        },
        patch: {
          tags: ["Authentication"],
          operationId: "updateCurrentUser",
          summary: "Update the signed-in user’s profile",
          description:
            "Accepts a browser session only — no personal access token scope grants the ability to change an account's own identity. Usernames are lowercased and must be unique.",
          security: sessionSecurity,
          requestBody: { required: true, content: json(schema("UpdateProfileInput")) },
          responses: {
            "200": response("The updated identity.", schema("CurrentUserResponse")),
            "401": errors.Unauthorized,
            "409": errors.Conflict,
            "422": errors.Validation,
          },
        },
      },
      "/v1/sessions": {
        get: {
          tags: ["Authentication"],
          operationId: "listSessions",
          summary: "List browser sessions",
          description: "Token and IP hashes are never returned.",
          security: sessionSecurity,
          responses: {
            "200": response("Active and revoked sessions.", schema("SessionsResponse")),
            "401": errors.Unauthorized,
          },
        },
      },
      "/v1/sessions/{sessionId}": {
        delete: {
          tags: ["Authentication"],
          operationId: "revokeSession",
          summary: "Revoke one browser session",
          security: sessionSecurity,
          parameters: [pathParameter("sessionId", "The session to revoke. Only the owner may revoke it.")],
          responses: { "204": response("Session revoked."), "401": errors.Unauthorized, "404": errors.NotFound },
        },
      },
      "/v1/orgs": {
        get: {
          tags: ["Organizations"],
          operationId: "listOrganizations",
          summary: "List organizations visible to the caller",
          description: "Requires a browser session or a PAT with `orgs:read` (or `admin:*`).",
          security: identitySecurity,
          responses: {
            "200": response("Visible organizations.", schema("OrganizationsResponse")),
            "401": errors.Unauthorized,
          },
        },
        post: {
          tags: ["Organizations"],
          operationId: "createOrganization",
          summary: "Create a new workspace",
          description: "Requires `orgs:write`. The caller becomes the workspace owner with a fresh, unique join code.",
          security: identitySecurity,
          requestBody: { required: true, content: json(schema("CreateOrganizationInput")) },
          responses: {
            "201": response("Workspace created.", schema("OrganizationResponse")),
            "401": errors.Unauthorized,
            "422": errors.Validation,
          },
        },
      },
      "/v1/join": {
        post: {
          tags: ["Organizations"],
          operationId: "joinOrganization",
          summary: "Join a workspace by invite code",
          description:
            "Requires `orgs:write`. Redeems a workspace's join code and creates a `member` membership. Rate limited 10/15min/IP, the same as a password check, since this is a caller-supplied secret being verified.",
          security: identitySecurity,
          requestBody: { required: true, content: json(schema("JoinOrganizationInput")) },
          responses: {
            "201": response("Joined the workspace.", schema("OrganizationResponse")),
            "401": errors.Unauthorized,
            "404": errors.NotFound,
            "409": errors.Conflict,
            "422": errors.Validation,
            "429": errors.RateLimited,
          },
        },
      },
      "/v1/orgs/{orgId}/rooms": {
        get: {
          tags: ["Rooms"],
          operationId: "listOrganizationRooms",
          summary: "List rooms visible within an organization",
          description:
            "Restricted rooms are excluded unless the caller has an explicit room membership or an elevated organizational role.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          responses: {
            "200": response("Visible rooms.", schema("RoomsResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
          },
        },
        post: {
          tags: ["Rooms"],
          operationId: "createRoom",
          summary: "Create a room",
          description:
            "Requires `rooms:write` and the `create_room` ABAC permission. The creator becomes the room owner.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          requestBody: { required: true, content: json(schema("CreateRoomInput")) },
          responses: {
            "201": response("Room created.", schema("RoomResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "422": errors.Validation,
          },
        },
      },
      "/v1/rooms/{roomId}": {
        get: {
          tags: ["Rooms"],
          operationId: "getRoom",
          summary: "Read a room and the caller’s effective role",
          description: "Requires `rooms:read` and room-level ABAC access.",
          security: identitySecurity,
          parameters: [pathParameter("roomId", "Room identifier.")],
          responses: {
            "200": response("Room details.", schema("RoomResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
          },
        },
      },
      "/v1/rooms/{roomId}/ticket": {
        post: {
          tags: ["Rooms"],
          operationId: "createRoomTicket",
          summary: "Create a short-lived live-room ticket",
          description:
            "Browser-session only. Present the returned signed ticket to the Cloudflare Room Durable Object; it expires after 120 seconds.",
          security: sessionSecurity,
          parameters: [pathParameter("roomId", "Room identifier.")],
          responses: {
            "200": response("Live-room ticket.", schema("RoomTicketResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
          },
        },
      },
      "/v1/rooms/{roomId}/events": {
        get: {
          tags: ["Rooms"],
          operationId: "listRoomEvents",
          summary: "Read durable room events",
          description:
            "High-frequency ephemeral collaboration data lives in the Room Durable Object; this endpoint returns the durable timeline only.",
          security: identitySecurity,
          parameters: [pathParameter("roomId", "Room identifier.")],
          responses: {
            "200": response("Room event timeline.", schema("RoomEventsResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
          },
        },
      },
      "/v1/rooms/{roomId}/members": {
        get: {
          tags: ["Rooms"],
          operationId: "listRoomMembers",
          summary: "List people with explicit membership in a room",
          security: identitySecurity,
          parameters: [pathParameter("roomId", "Room identifier.")],
          responses: {
            "200": response("Room members.", schema("RoomMembersResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
          },
        },
        post: {
          tags: ["Rooms"],
          operationId: "addRoomMember",
          summary: "Grant an organization member access to a room",
          description:
            "Requires `rooms:write` and the room `manage` permission. The target must already belong to the room’s organization.",
          security: identitySecurity,
          parameters: [pathParameter("roomId", "Room identifier.")],
          requestBody: { required: true, content: json(schema("AddRoomMemberInput")) },
          responses: {
            "201": response("Room membership created.", schema("RoomMembershipResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
            "409": errors.Conflict,
            "422": errors.Validation,
          },
        },
      },
      "/v1/rooms/{roomId}/members/{userId}": {
        delete: {
          tags: ["Rooms"],
          operationId: "removeRoomMember",
          summary: "Revoke a person's explicit membership in a room",
          description:
            "Requires `rooms:write` and the room `manage` permission. The room owner cannot be removed this way — remove them from the organization instead.",
          security: identitySecurity,
          parameters: [pathParameter("roomId", "Room identifier."), pathParameter("userId", "Target user identifier.")],
          responses: {
            "204": { description: "Membership removed." },
            "400": errors.Validation,
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
          },
        },
      },
      "/v1/orgs/{orgId}/members": {
        get: {
          tags: ["Organizations"],
          operationId: "listOrganizationMembers",
          summary: "List organization members",
          description: "Requires `orgs:read` and organization membership.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          responses: {
            "200": response("Organization members.", schema("OrganizationMembersResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
          },
        },
        post: {
          tags: ["Organizations"],
          operationId: "addOrganizationMember",
          summary: "Add an existing user to an organization",
          description: "Requires `orgs:write` plus `manage_members`; only an owner may assign the `admin` role.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          requestBody: { required: true, content: json(schema("AddOrganizationMemberInput")) },
          responses: {
            "201": response("Organization membership created.", schema("OrganizationMemberResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
            "409": errors.Conflict,
            "422": errors.Validation,
          },
        },
      },
      "/v1/orgs/{orgId}/invite": {
        get: {
          tags: ["Organizations"],
          operationId: "getOrganizationInvite",
          summary: "Read a workspace's join code",
          description:
            "Owners and admins can always read this; a plain member can only when the workspace has `allowMemberInvites` enabled. A caller with no membership in `orgId` gets `403`, the same as a real org they can't view — this endpoint deliberately never distinguishes 'wrong permission' from 'no such organization'.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          responses: {
            "200": response("The current join code.", schema("InviteResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
          },
        },
      },
      "/v1/orgs/{orgId}/invite/regenerate": {
        post: {
          tags: ["Organizations"],
          operationId: "regenerateOrganizationInvite",
          summary: "Regenerate a workspace's join code",
          description:
            "Invalidates the previous code immediately. Same permission gate — and same no-existence-leak behavior — as reading the invite.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          responses: {
            "200": response("A newly generated join code.", schema("InviteResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
          },
        },
      },
      "/v1/orgs/{orgId}/settings": {
        patch: {
          tags: ["Organizations"],
          operationId: "updateOrganizationSettings",
          summary: "Update workspace settings",
          description: "Requires `orgs:write` plus `manage_members`. Currently controls `allowMemberInvites`.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          requestBody: { required: true, content: json(schema("UpdateOrganizationSettingsInput")) },
          responses: {
            "200": response("Updated settings.", schema("UpdateOrganizationSettingsInput")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
            "422": errors.Validation,
          },
        },
      },
      "/v1/orgs/{orgId}/members/{userId}": {
        patch: {
          tags: ["Organizations"],
          operationId: "updateOrganizationMemberRole",
          summary: "Change a member's role",
          description:
            "Requires `orgs:write` plus `manage_members`; only an owner may assign `admin`. The owner's own role cannot be changed here, and an admin cannot self-demote to member while they are the organization's only admin.",
          security: identitySecurity,
          parameters: [
            pathParameter("orgId", "Organization identifier."),
            pathParameter("userId", "Target user identifier."),
          ],
          requestBody: { required: true, content: json(schema("UpdateOrganizationMemberInput")) },
          responses: {
            "200": response("Updated member.", schema("OrganizationMemberResponse")),
            "400": errors.BadRequest,
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "404": errors.NotFound,
            "422": errors.Validation,
          },
        },
      },
      "/v1/orgs/{orgId}/calendar": {
        get: {
          tags: ["Organizations"],
          operationId: "listCalendarEvents",
          summary: "List visible calendar events",
          description: "Room-attached events are filtered through the same room access policy as rooms and timelines.",
          security: identitySecurity,
          parameters: [
            pathParameter("orgId", "Organization identifier."),
            queryParameter("from", "Optional inclusive ISO 8601 lower bound.", false, "date-time"),
            queryParameter("to", "Optional inclusive ISO 8601 upper bound.", false, "date-time"),
          ],
          responses: {
            "200": response("Visible calendar events.", schema("CalendarEventsResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "422": errors.Validation,
          },
        },
        post: {
          tags: ["Organizations"],
          operationId: "createCalendarEvent",
          summary: "Schedule an organization or room event",
          description: "Requires `orgs:write` and the `schedule` ABAC permission. `endsAt` must be after `startsAt`.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          requestBody: { required: true, content: json(schema("CreateCalendarEventInput")) },
          responses: {
            "201": response("Calendar event created.", schema("CalendarEventResponse")),
            "400": errors.BadRequest,
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "422": errors.Validation,
          },
        },
      },
      "/v1/orgs/{orgId}/activity": {
        get: {
          tags: ["Organizations"],
          operationId: "listOrganizationActivity",
          summary: "Read recent visible room activity",
          description: "Returns at most 100 durable events and only includes rooms visible to the caller.",
          security: identitySecurity,
          parameters: [pathParameter("orgId", "Organization identifier.")],
          responses: {
            "200": response("Visible activity stream.", schema("ActivityResponse")),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
          },
        },
      },
      "/v1/pats": {
        get: {
          tags: ["Personal access tokens"],
          operationId: "listPersonalAccessTokens",
          summary: "List the signed-in user’s PAT metadata",
          description: "Browser-session only. Token secrets and token hashes are never returned.",
          security: sessionSecurity,
          responses: {
            "200": response("Personal access token metadata.", schema("PersonalAccessTokensResponse")),
            "401": errors.Unauthorized,
          },
        },
        post: {
          tags: ["Personal access tokens"],
          operationId: "createPersonalAccessToken",
          summary: "Create a scoped personal access token",
          description: "Browser-session only. The token secret is shown exactly once; store it securely.",
          security: sessionSecurity,
          requestBody: { required: true, content: json(schema("CreatePersonalAccessTokenInput")) },
          responses: {
            "201": response("PAT metadata and one-time secret.", schema("CreatePersonalAccessTokenResponse")),
            "401": errors.Unauthorized,
            "422": errors.Validation,
          },
        },
      },
      "/v1/pats/{tokenId}": {
        delete: {
          tags: ["Personal access tokens"],
          operationId: "revokePersonalAccessToken",
          summary: "Revoke a personal access token",
          security: sessionSecurity,
          parameters: [pathParameter("tokenId", "Personal access token identifier.")],
          responses: { "204": response("PAT revoked."), "401": errors.Unauthorized, "404": errors.NotFound },
        },
      },
      "/v1/oidc/clients": {
        get: {
          tags: ["OIDC"],
          operationId: "listOidcClients",
          summary: "List registered first-party OIDC clients",
          description: "Browser-session only. Client secrets are never used or returned: Threadline clients use PKCE.",
          security: sessionSecurity,
          responses: { "200": response("OIDC clients.", schema("OidcClientsResponse")), "401": errors.Unauthorized },
        },
      },
      "/.well-known/openid-configuration": {
        get: {
          tags: ["OIDC"],
          operationId: "getOpenIdConfiguration",
          summary: "Read OpenID Provider Discovery metadata",
          responses: { "200": response("OpenID Connect Discovery document.", schema("OpenIdConfiguration")) },
        },
      },
      "/oauth/jwks.json": {
        get: {
          tags: ["OIDC"],
          operationId: "getJwks",
          summary: "Read public JSON Web Keys",
          description: "Only public RSA signing-key material is returned.",
          responses: { "200": response("JSON Web Key Set.", schema("Jwks")) },
        },
      },
      "/oauth/authorize": {
        get: {
          tags: ["OIDC"],
          operationId: "authorize",
          summary: "Start an Authorization Code + PKCE flow",
          description:
            "Requires a signed-in browser session. Unauthenticated callers are redirected to the configured Threadline login page. Only registered first-party clients and exact redirect URIs are accepted.",
          parameters: [
            { name: "response_type", in: "query", required: true, schema: { type: "string", const: "code" } },
            queryParameter("client_id", "Registered first-party client identifier.", true),
            { name: "redirect_uri", in: "query", required: true, schema: { type: "string", format: "uri" } },
            queryParameter("scope", "Space-delimited scopes. Must include `openid`.", true),
            queryParameter("state", "CSRF state supplied by the client (8–2048 characters).", true),
            queryParameter("code_challenge", "S256 PKCE code challenge (43–128 characters).", true),
            { name: "code_challenge_method", in: "query", required: true, schema: { type: "string", const: "S256" } },
            queryParameter("nonce", "Optional ID token replay-prevention nonce."),
          ],
          responses: {
            "302": { description: "Redirects to login or the validated client callback with `code` and `state`." },
            "400": errors.BadRequest,
            "422": errors.Validation,
          },
        },
      },
      "/oauth/token": {
        post: {
          tags: ["OIDC"],
          operationId: "token",
          summary: "Exchange an authorization code or rotate a refresh token",
          description:
            "Accepts `application/x-www-form-urlencoded` form data. Authorization Code uses PKCE; refresh token rotation invalidates the presented refresh token.",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  oneOf: [schema("AuthorizationCodeGrantInput"), schema("RefreshTokenGrantInput")],
                  discriminator: { propertyName: "grant_type" },
                },
              },
            },
          },
          responses: {
            "200": response("Token set.", schema("TokenResponse")),
            "400": errors.BadRequest,
            "422": errors.Validation,
          },
        },
      },
      "/oauth/revoke": {
        post: {
          tags: ["OIDC"],
          operationId: "revoke",
          summary: "Revoke a refresh token",
          description: "Accepts form data. Returns 200 even when the token is unknown, per OAuth revocation practice.",
          requestBody: {
            required: true,
            content: { "application/x-www-form-urlencoded": { schema: schema("RevokeTokenInput") } },
          },
          responses: { "200": response("Revocation request processed."), "422": errors.Validation },
        },
      },
      "/oauth/introspect": {
        post: {
          tags: ["OIDC"],
          operationId: "introspect",
          summary: "Inspect an access token",
          description:
            "Accepts form data. Invalid, expired, or malformed tokens return `{ active: false }` rather than an error.",
          requestBody: {
            required: true,
            content: { "application/x-www-form-urlencoded": { schema: schema("IntrospectTokenInput") } },
          },
          responses: { "200": response("Token activity information.", schema("IntrospectionResponse")) },
        },
      },
      "/oauth/userinfo": {
        get: {
          tags: ["OIDC"],
          operationId: "getUserInfo",
          summary: "Read OIDC subject claims",
          description: "Requires a valid OIDC access token in `Authorization: Bearer <access_token>`.",
          security: [{ oidcAccessToken: [] }],
          responses: { "200": response("Subject claims.", schema("UserInfo")), "401": errors.Unauthorized },
        },
      },
      "/v1/internal/room-events": {
        post: {
          tags: ["Internal"],
          operationId: "ingestRoomEvent",
          summary: "Persist a room event from the realtime service",
          description:
            "Cloudflare Durable Objects only. Send the shared ingress credential in `X-Threadline-Ingest`. Presence events require join permission; mutations require write permission. A stable deliveryId makes retries idempotent. Do not expose the credential to browsers or third parties.",
          security: [{ roomEventIngress: [] }],
          requestBody: { required: true, content: json(schema("IngestRoomEventInput")) },
          responses: {
            "202": response("Event accepted for durable storage."),
            "401": errors.Unauthorized,
            "403": errors.Forbidden,
            "422": errors.Validation,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "threadline_session",
          description:
            "HttpOnly browser session established by register or login. Swagger UI includes same-origin cookies when available.",
        },
        personalAccessToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Threadline PAT",
          description:
            "A one-time-revealed token beginning with `tl_pat_`. Required scopes are stated on each operation.",
        },
        oidcAccessToken: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        roomEventIngress: {
          type: "apiKey",
          in: "header",
          name: "X-Threadline-Ingest",
          description: "Internal shared secret between the API and Threadline realtime service.",
        },
      },
      schemas: {
        Health: {
          type: "object",
          required: ["status", "service"],
          properties: { status: { type: "string", const: "ok" }, service: { type: "string", const: "threadline-api" } },
        },
        Error: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: { type: "string", examples: ["validation_error"] },
            message: { type: "string", examples: ["Request validation failed."] },
          },
        },
        User: {
          type: "object",
          required: ["id", "email", "username", "displayName", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            username: { type: "string", minLength: 3, maxLength: 32 },
            displayName: { type: "string", maxLength: 80 },
            avatar: { type: "string", format: "uri" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Organization: {
          type: "object",
          required: ["id", "name", "slug", "allowMemberInvites", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            slug: { type: "string" },
            allowMemberInvites: {
              type: "boolean",
              description: "When true, any member (not just owner/admin) may read and share the join code.",
            },
            createdAt: { type: "string", format: "date-time" },
            role: { type: "string", enum: ["owner", "admin", "member"] },
            attributes: schema("MembershipAttributes"),
          },
          description: "The join code is never included here — see `GET /v1/orgs/{orgId}/invite`.",
        },
        MembershipAttributes: {
          type: "object",
          properties: {
            canCreateRooms: { type: "boolean" },
            canManageMembers: { type: "boolean" },
            canSchedule: { type: "boolean" },
          },
        },
        Room: {
          type: "object",
          required: ["id", "orgId", "name", "visibility", "classification", "createdBy", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            orgId: { type: "string", format: "uuid" },
            name: { type: "string", minLength: 2, maxLength: 100 },
            description: { type: "string", maxLength: 300 },
            visibility: { type: "string", enum: ["organization", "restricted"] },
            classification: { type: "string", enum: ["internal", "confidential"] },
            createdBy: { type: "string", format: "uuid" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        RoomEvent: {
          type: "object",
          required: ["id", "roomId", "type", "payload", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            roomId: { type: "string", format: "uuid" },
            type: { type: "string", maxLength: 100 },
            payload: {},
            actorId: { type: "string", format: "uuid" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CalendarEvent: {
          type: "object",
          required: ["id", "orgId", "title", "startsAt", "endsAt", "createdBy", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            orgId: { type: "string", format: "uuid" },
            roomId: { type: "string", format: "uuid" },
            title: { type: "string", maxLength: 160 },
            description: { type: "string", maxLength: 1000 },
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
            createdBy: { type: "string", format: "uuid" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        OrganizationMember: {
          allOf: [
            schema("User"),
            {
              type: "object",
              required: ["role", "joinedAt"],
              properties: {
                role: { type: "string", enum: ["owner", "admin", "member"] },
                attributes: schema("MembershipAttributes"),
                joinedAt: { type: "string", format: "date-time" },
              },
            },
          ],
        },
        RoomMember: {
          allOf: [
            schema("User"),
            {
              type: "object",
              required: ["role", "joinedAt"],
              properties: {
                role: { type: "string", enum: ["owner", "host", "member", "viewer"] },
                joinedAt: { type: "string", format: "date-time" },
              },
            },
          ],
        },
        Session: {
          type: "object",
          required: ["id", "userId", "createdAt", "expiresAt", "lastUsedAt", "isCurrent"],
          properties: {
            id: { type: "string", format: "uuid" },
            userId: { type: "string", format: "uuid" },
            userAgent: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time" },
            lastUsedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            isCurrent: { type: "boolean" },
          },
        },
        PersonalAccessToken: {
          type: "object",
          required: ["id", "userId", "label", "tokenPrefix", "scopes", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            userId: { type: "string", format: "uuid" },
            label: { type: "string", maxLength: 80 },
            tokenPrefix: { type: "string", examples: ["tl_pat_abcd1234"] },
            scopes: { type: "array", minItems: 1, items: { type: "string", enum: scopeValues } },
            expiresAt: { type: "string", format: "date-time" },
            lastUsedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        OidcClient: {
          type: "object",
          required: ["id", "name", "redirectUris", "allowedScopes", "isFirstParty", "createdAt"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            redirectUris: { type: "array", items: { type: "string", format: "uri" } },
            allowedScopes: { type: "array", items: { type: "string", enum: scopeValues } },
            isFirstParty: { type: "boolean", const: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        RegistrationInput: {
          type: "object",
          required: ["email", "username", "displayName", "password"],
          properties: {
            email: { type: "string", format: "email" },
            username: { type: "string", pattern: "^[a-zA-Z0-9-]+$", minLength: 3, maxLength: 32 },
            displayName: { type: "string", minLength: 2, maxLength: 80 },
            password: { type: "string", format: "password", minLength: 10, maxLength: 128 },
          },
        },
        UpdateProfileInput: {
          type: "object",
          minProperties: 1,
          description: "At least one field must be supplied. Omitted fields are left unchanged.",
          properties: {
            username: { type: "string", pattern: "^[a-zA-Z0-9-]+$", minLength: 3, maxLength: 32 },
            displayName: { type: "string", minLength: 2, maxLength: 80 },
          },
        },
        LoginInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password", maxLength: 128 },
          },
        },
        ChangePasswordInput: {
          type: "object",
          required: ["currentPassword", "password"],
          properties: {
            currentPassword: { type: "string", format: "password" },
            password: { type: "string", format: "password", minLength: 10, maxLength: 128 },
          },
        },
        EmailInput: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } },
        ConfirmPasswordResetInput: {
          type: "object",
          required: ["token", "password"],
          properties: {
            token: { type: "string", minLength: 20 },
            password: { type: "string", format: "password", minLength: 10, maxLength: 128 },
          },
        },
        VerificationTokenInput: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", minLength: 20 } },
        },
        CreateRoomInput: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 100 },
            description: { type: "string", maxLength: 300 },
            visibility: { type: "string", enum: ["organization", "restricted"], default: "organization" },
            classification: { type: "string", enum: ["internal", "confidential"], default: "internal" },
            memberIds: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              description: "Existing organization members to grant room member access during creation.",
              items: { type: "string", format: "uuid" },
            },
          },
        },
        AddOrganizationMemberInput: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["admin", "member"], default: "member" },
            attributes: schema("MembershipAttributes"),
          },
        },
        CreateOrganizationInput: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 2, maxLength: 80 } },
        },
        JoinOrganizationInput: {
          type: "object",
          required: ["code"],
          properties: {
            code: {
              type: "string",
              description: "An 8-character join code. Case-insensitive; whitespace is ignored.",
            },
          },
        },
        UpdateOrganizationSettingsInput: {
          type: "object",
          required: ["allowMemberInvites"],
          properties: { allowMemberInvites: { type: "boolean" } },
        },
        UpdateOrganizationMemberInput: {
          type: "object",
          required: ["role"],
          properties: { role: { type: "string", enum: ["admin", "member"] } },
        },
        AddRoomMemberInput: {
          type: "object",
          required: ["userId"],
          properties: {
            userId: { type: "string", format: "uuid" },
            role: { type: "string", enum: ["host", "member", "viewer"], default: "member" },
          },
        },
        CreateCalendarEventInput: {
          type: "object",
          required: ["title", "startsAt", "endsAt"],
          properties: {
            title: { type: "string", minLength: 2, maxLength: 160 },
            description: { type: "string", maxLength: 1000 },
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
            roomId: { type: "string", format: "uuid" },
          },
        },
        CreatePersonalAccessTokenInput: {
          type: "object",
          required: ["label", "scopes"],
          properties: {
            label: { type: "string", minLength: 2, maxLength: 80 },
            scopes: {
              type: "array",
              minItems: 1,
              maxItems: scopeValues.length,
              items: { type: "string", enum: scopeValues },
            },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        IngestRoomEventInput: {
          type: "object",
          required: ["roomId", "event"],
          properties: {
            deliveryId: {
              type: "string",
              format: "uuid",
              description: "Stable across retries so ingest is idempotent.",
            },
            roomId: { type: "string", format: "uuid" },
            event: {
              type: "object",
              required: ["type", "payload", "from", "at"],
              properties: {
                type: {
                  type: "string",
                  enum: ["participant.joined", "participant.left", "chat", "editor", "screen-share"],
                },
                payload: {},
                from: { type: "string", format: "uuid" },
                at: { type: "string", format: "date-time" },
              },
            },
          },
        },
        AuthorizationCodeGrantInput: {
          type: "object",
          required: ["grant_type", "code", "client_id", "redirect_uri", "code_verifier"],
          properties: {
            grant_type: { type: "string", const: "authorization_code" },
            code: { type: "string", minLength: 20 },
            client_id: { type: "string" },
            redirect_uri: { type: "string", format: "uri" },
            code_verifier: { type: "string", minLength: 43, maxLength: 128 },
          },
        },
        RefreshTokenGrantInput: {
          type: "object",
          required: ["grant_type", "refresh_token", "client_id"],
          properties: {
            grant_type: { type: "string", const: "refresh_token" },
            refresh_token: { type: "string", minLength: 20 },
            client_id: { type: "string" },
          },
        },
        RevokeTokenInput: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", minLength: 20 } },
        },
        IntrospectTokenInput: {
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", minLength: 20 } },
        },
        RegistrationResponse: {
          type: "object",
          required: ["user"],
          properties: { user: schema("User") },
        },
        LoginResponse: { type: "object", required: ["user"], properties: { user: schema("User") } },
        AcceptedMessage: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
        CurrentUserResponse: {
          type: "object",
          required: ["user", "organizations"],
          properties: {
            user: {
              allOf: [
                schema("User"),
                { type: "object", required: ["emailVerified"], properties: { emailVerified: { type: "boolean" } } },
              ],
            },
            organizations: { type: "array", items: schema("Organization") },
          },
        },
        SessionsResponse: {
          type: "object",
          required: ["sessions"],
          properties: { sessions: { type: "array", items: schema("Session") } },
        },
        OrganizationsResponse: {
          type: "object",
          required: ["organizations"],
          properties: { organizations: { type: "array", items: schema("Organization") } },
        },
        OrganizationResponse: {
          type: "object",
          required: ["organization"],
          properties: { organization: schema("Organization") },
        },
        InviteResponse: {
          type: "object",
          required: ["joinCode", "allowMemberInvites"],
          properties: {
            joinCode: { type: "string" },
            allowMemberInvites: { type: "boolean" },
          },
        },
        RoomsResponse: {
          type: "object",
          required: ["rooms"],
          properties: { rooms: { type: "array", items: schema("Room") } },
        },
        RoomResponse: {
          type: "object",
          required: ["room", "role"],
          properties: { room: schema("Room"), role: { type: "string", enum: ["owner", "host", "member", "viewer"] } },
        },
        RoomTicketResponse: {
          type: "object",
          required: ["ticket", "roomId", "expiresIn"],
          properties: {
            ticket: { type: "string", description: "Signed JWT-like room ticket." },
            roomId: { type: "string", format: "uuid" },
            expiresIn: { type: "integer", const: 120 },
            iceServers: {
              type: "array",
              description: "Short-lived STUN/TURN configuration when a relay provider is configured.",
              items: {
                type: "object",
                required: ["urls"],
                properties: {
                  urls: {
                    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }],
                  },
                  username: { type: "string" },
                  credential: { type: "string" },
                },
              },
            },
          },
        },
        RoomEventsResponse: {
          type: "object",
          required: ["events"],
          properties: { events: { type: "array", items: schema("RoomEvent") } },
        },
        OrganizationMembersResponse: {
          type: "object",
          required: ["members"],
          properties: { members: { type: "array", items: schema("OrganizationMember") } },
        },
        OrganizationMemberResponse: {
          type: "object",
          required: ["member"],
          properties: { member: schema("OrganizationMember") },
        },
        RoomMembersResponse: {
          type: "object",
          required: ["members"],
          properties: { members: { type: "array", items: schema("RoomMember") } },
        },
        RoomMembershipResponse: {
          type: "object",
          required: ["membership"],
          properties: {
            membership: {
              type: "object",
              required: ["id", "roomId", "userId", "role", "joinedAt"],
              properties: {
                id: { type: "string", format: "uuid" },
                roomId: { type: "string", format: "uuid" },
                userId: { type: "string", format: "uuid" },
                role: { type: "string", enum: ["owner", "host", "member", "viewer"] },
                joinedAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        CalendarEventsResponse: {
          type: "object",
          required: ["events"],
          properties: { events: { type: "array", items: schema("CalendarEvent") } },
        },
        CalendarEventResponse: { type: "object", required: ["event"], properties: { event: schema("CalendarEvent") } },
        ActivityResponse: {
          type: "object",
          required: ["events", "rooms"],
          properties: {
            events: { type: "array", items: schema("RoomEvent") },
            rooms: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name"],
                properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } },
              },
            },
          },
        },
        PersonalAccessTokensResponse: {
          type: "object",
          required: ["tokens"],
          properties: { tokens: { type: "array", items: schema("PersonalAccessToken") } },
        },
        CreatePersonalAccessTokenResponse: {
          type: "object",
          required: ["token", "secret"],
          properties: {
            token: schema("PersonalAccessToken"),
            secret: {
              type: "string",
              pattern: "^tl_pat_",
              writeOnly: true,
              description: "One-time secret; never returned again.",
            },
          },
        },
        OidcClientsResponse: {
          type: "object",
          required: ["clients"],
          properties: { clients: { type: "array", items: schema("OidcClient") } },
        },
        OpenIdConfiguration: {
          type: "object",
          required: ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"],
          properties: {
            issuer: { type: "string", format: "uri" },
            authorization_endpoint: { type: "string", format: "uri" },
            token_endpoint: { type: "string", format: "uri" },
            revocation_endpoint: { type: "string", format: "uri" },
            introspection_endpoint: { type: "string", format: "uri" },
            userinfo_endpoint: { type: "string", format: "uri" },
            jwks_uri: { type: "string", format: "uri" },
            response_types_supported: { type: "array", items: { type: "string" } },
            grant_types_supported: { type: "array", items: { type: "string" } },
            code_challenge_methods_supported: { type: "array", items: { type: "string" } },
            scopes_supported: { type: "array", items: { type: "string" } },
          },
        },
        Jwks: {
          type: "object",
          required: ["keys"],
          properties: {
            keys: {
              type: "array",
              items: {
                type: "object",
                required: ["kty", "n", "e"],
                properties: {
                  kty: { type: "string", const: "RSA" },
                  kid: { type: "string" },
                  use: { type: "string", const: "sig" },
                  alg: { type: "string", const: "RS256" },
                  n: { type: "string" },
                  e: { type: "string" },
                },
              },
            },
          },
        },
        TokenResponse: {
          type: "object",
          required: ["token_type", "access_token", "expires_in", "scope"],
          properties: {
            token_type: { type: "string", const: "Bearer" },
            access_token: { type: "string", description: "15-minute RS256 JWT access token." },
            id_token: { type: "string", description: "Present for authorization-code exchange." },
            refresh_token: { type: "string", description: "Present for both supported grants; rotated on refresh." },
            expires_in: { type: "integer", const: 900 },
            scope: { type: "string" },
          },
        },
        IntrospectionResponse: {
          oneOf: [
            { type: "object", required: ["active"], properties: { active: { type: "boolean", const: false } } },
            {
              type: "object",
              required: ["active", "sub", "scope", "client_id", "iss", "exp", "iat"],
              properties: {
                active: { type: "boolean", const: true },
                sub: { type: "string", format: "uuid" },
                scope: { type: "string" },
                client_id: { type: "string" },
                iss: { type: "string", format: "uri" },
                exp: { type: "integer" },
                iat: { type: "integer" },
              },
            },
          ],
        },
        UserInfo: {
          type: "object",
          required: ["sub", "email", "email_verified", "preferred_username", "name"],
          properties: {
            sub: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            email_verified: { type: "boolean" },
            preferred_username: { type: "string" },
            name: { type: "string" },
          },
        },
      },
    },
  };
}

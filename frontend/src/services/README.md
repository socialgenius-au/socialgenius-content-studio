# Service / adapter layer

Every module in the platform reads data through a `*Service.ts` file here,
never directly from `src/mocks/*`. Components call the service; the service
currently resolves mock data via `mockDelay()`.

**Backend integration contract**: when a real endpoint exists, replace the
body of the relevant function with a call through `src/api/client.ts` (same
axios instance/interceptor pattern already used by `clientsApi`, `brandsApi`,
etc.), keeping the exported function signature identical. No component should
need to change.

Each file below is marked `// TODO(integration):` with the expected
endpoint shape once the owning backend exists (see section 58 of the product
spec for module ownership — most of these belong to Positioning Tool, Social
Audit, OpsGenius, SocialProFlow, or Strategic Intelligence, not Content
Studio itself).
